import { stashOauth } from './oauth-utils'
import { AuthenticationState } from './authentication-state'
import { AuthenticationDetailsCallback, AuthStrategy } from './auth-strategy'
import { Auth0Machine2Machine, StashConfiguration } from '../stash-config'
import { describeError } from '../utils'
import { awsConfig } from '../aws'

export type StashProfileAuth0Machine2Machine = {
  config: Omit<StashConfiguration, 'identityProvider'> & { identityProvider: Auth0Machine2Machine }
}

export class Auth0Machine2MachineStrategy implements AuthStrategy {
  private state: AuthenticationState = { name: "unauthenticated" }

  constructor(private profile: StashProfileAuth0Machine2Machine) {}

  public async initialise(): Promise<void> {
    await this.authenticate()
    this.scheduleTokenRefresh()
  }

  public isFresh(): boolean {
    if (this.state.name !== "authenticated") {
      return false
    }

    const now = (new Date()).getTime()

    const awsConfigExpiration = this.state.awsConfig.credentials!.expiration
    // If we don't have an expiration it means we are not federating and the creds do not expire.
    const awsCredsAreFresh = !awsConfigExpiration || awsConfigExpiration.getTime() > now
    const auth0CredsAreFresh = this.state.oauthInfo.expiry > now

    return awsCredsAreFresh && auth0CredsAreFresh
  }

  public async withAuthentication<R>(callback: AuthenticationDetailsCallback<R>): Promise<R> {
    if (this.state.name != "authenticated") {
      await this.authenticate()
    }

    if (this.state.name == "authenticated") {
      try {
        return await callback({authToken: this.state.oauthInfo.accessToken, awsConfig: this.state.awsConfig})
      } catch (err) {
        return Promise.reject(`API call failed: ${describeError(err)}`)
      }
    } else if (this.state.name == "authentication-failed") {
      return Promise.reject(`Authentication failure: ${this.state.error}`)
    } else {
      return Promise.reject("Internal error: unreachable state")
    }
  }

  private async scheduleTokenRefresh(): Promise<void> {
    if (this.state.name == "authenticated") {
      const { refreshToken, expiry } = this.state.oauthInfo
      const timeout = setTimeout(async () => {
        try {
          await this.performTokenRefreshAndUpdateState(refreshToken)
        } finally {
          this.scheduleTokenRefresh()
        }
      }, (expiry * 1000) - (EXPIRY_BUFFER_SECONDS * 1000) - Date.now())
      timeout.unref()
    } else if (this.state.name == "authentication-expired") {
      const { refreshToken } = this.state.oauthInfo
      try {
        await this.performTokenRefreshAndUpdateState(refreshToken)
      } finally {
        this.scheduleTokenRefresh()
      }
    }
  }

  private async performTokenRefreshAndUpdateState(refreshToken: string): Promise<void> {
    try {
      const oauthInfo = await stashOauth.performTokenRefresh(
        this.profile.config.identityProvider.host,
        refreshToken,
        this.profile.config.identityProvider.clientId
      )

      if (this.state.name == "authenticated") {
        this.state = {
          name: "authenticated",
          oauthInfo,
          awsConfig: await awsConfig(this.profile.config.keyManagement.awsCredentials, oauthInfo.accessToken)
        }
      }
    } catch (err) {
      this.state = {
        name: "authentication-failed",
        error: describeError(err)
      }
    }
  }

  private async authenticate(): Promise<void> {
    try {
      const oauthInfo = await stashOauth.authenticateViaClientCredentials(
        this.profile.config.identityProvider.host,
        this.profile.config.service.host,
        this.profile.config.identityProvider.clientId,
        this.profile.config.identityProvider.clientSecret
      )
      try {
        this.state = {
          name: "authenticated",
          oauthInfo,
          awsConfig: await awsConfig(this.profile.config.keyManagement.awsCredentials, oauthInfo.accessToken)
        }
      } catch (error) {
        this.state = { name: "authentication-failed", error: `Token federation failure: ${describeError(error)}` }
      }
    } catch (error) {
      this.state = { name: "authentication-failed", error: `Oauth failure: ${describeError(error)}` }
    }
  }
}

/* Refresh tokens before the expiry to avoid API errors due
 * to race conditions. Expiry buffer is in seconds */
const EXPIRY_BUFFER_SECONDS = 20

export type ClientCredentials = {
  clientId: string,
  clientSecret: string
}

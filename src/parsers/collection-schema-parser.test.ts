import { isRight } from 'fp-ts/lib/Either'
import { ExactIndex, MatchIndex, parseIndexDefinition, RangeIndex, typecheckCollectionSchemaDefinition } from './collection-schema-parser'
import { isOk } from '../result'

describe("Index definition: Exact", () => {
  it("parses valid index definition", () => {
    const def = {
      "kind": "exact",
      "field": "title"
    }

    const parsed = ExactIndex.decode(def)
    expect(isRight(parsed)).toBe(true)
  })

  it("parses invalid index definition", () => {
    const def = {
      "kind": "garbage",
      "field": "title"
    }

    const parsed = ExactIndex.decode(def)
    expect(isRight(parsed)).toBe(false)
  })
})

describe("Index definition: Range", () => {
  it("parses valid index definition", () => {
    const def = {
      "kind": "range",
      "field": "title"
    }

    const parsed = RangeIndex.decode(def)
    expect(isRight(parsed)).toBe(true)
  })

  it("parses invalid index definition", () => {
    const def = {
      "kind": "garbage",
      "field": "title"
    }

    const parsed = RangeIndex.decode(def)
    expect(isRight(parsed)).toBe(false)
  })
})

describe("Index definition: Match", () => {
  it("parses valid index definition", () => {
    const def = {
      "kind": "match",
      "fields": ["title"],
      "tokenFilters": [
        { "kind": "downcase" },
        { "kind": "ngram", "tokenLength": 3 }
      ],
      "tokenizer": { "kind": "standard" }
    }

    const parsed = MatchIndex.decode(def)
    expect(isRight(parsed)).toBe(true)
  })

  it("parses invalid index definition", () => {
    const def = {
      "kind": "match",
      // Should be an array of fields
      "fields": "title",
      "tokenFilters": [
        { "kind": "downcase" },
        { "kind": "ngram", "tokenLength": 3 }
      ],
      "tokenizer": { "kind": "standard" }
    }

    const parsed = MatchIndex.decode(def)
    expect(isRight(parsed)).toBe(false)
  })
})

describe("Entire indexes definition", () => {
  it("can be parsed", () => {
    const indexes = {
      "exactTitle": { "kind": "exact", "field": "title" },
      "runningTime": { "kind": "range", "field": "runningTime" },
      "year": { "kind": "range", "field": "year" },
      "title": {
        "kind": "match",
        "fields": ["title"],
        "tokenFilters": [
          { "kind": "downcase" },
          { "kind": "ngram", "tokenLength": 3 }
        ],
        "tokenizer": { "kind": "standard" }
      }
    }

    const parsed = parseIndexDefinition(indexes)
    expect(isOk(parsed)).toBe(true)
  })
})

describe("Typechecking", () => {
  describe("when there are no type errors", () => {
    it("type checking should succeed", () => {
      const schema = {
        "type": {
          "title": "string",
          "runningTime": "number",
          "year": "number"
        },
        "indexes": {
          "exactTitle": { "kind": "exact", "field": "title" },
          "runningTime": { "kind": "range", "field": "runningTime" },
          "year": { "kind": "range", "field": "year" },
          "title": {
            "kind": "match",
            "fields": ["title"],
            "tokenFilters": [
              { "kind": "downcase" },
              { "kind": "ngram", "tokenLength": 3 }
            ],
            "tokenizer": { "kind": "standard" }
          }
        }
      }

      const checked = typecheckCollectionSchemaDefinition(schema)
      expect(isOk(checked)).toBe(true)
    })
  })

  describe("when there is a match index type error", () => {
    it("type checking should fail", () => {
      const schema = {
        "type": {
          "runningTime": "number",
        },
        "indexes": {
          "title": {
            "kind": "match",
            "fields": ["runningTime"],
            "tokenFilters": [
              { "kind": "downcase" },
              { "kind": "ngram", "tokenLength": 3 }
            ],
            "tokenizer": { "kind": "standard" }
          }
        }
      }

      const checked = typecheckCollectionSchemaDefinition(schema)
      if (checked.ok) {
        fail("type checking should have failed")
        return
      }

      expect(checked.error).toEqual(`index type "match" works on fields of type "string" but field "runningTime" is of type "number"`)
    })
  })

  describe("when there is a range index type error", () => {
    it("type checking should fail", () => {
      const schema = {
        "type": {
          "title": "string",
        },
        "indexes": {
          "title": { "kind": "range", "field": "title" }
        }
      }

      const checked = typecheckCollectionSchemaDefinition(schema)
      if (checked.ok) {
        fail("type checking should have failed")
        return
      }

      expect(checked.error).toEqual(`index type "range" works on fields of type "number, bigint, date, boolean" but field "title" is of type "string"`)
    })
  })
})
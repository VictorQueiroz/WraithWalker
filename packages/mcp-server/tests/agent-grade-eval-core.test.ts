import { describe, expect, it } from "vitest";

import {
  AGENT_EVAL_TASKS,
  extractToolObservations,
  renderTaskScoreMarkdown,
  sanitizeArgumentShape,
  scoreTaskFailure,
  scoreTaskRun,
  type RunReport,
  type SanitizedToolEvent
} from "../scripts/agent-grade-eval-core.mts";

const SEED_TASK = AGENT_EVAL_TASKS.find(
  (task) => task.id === "seed-discovery"
)!;
const PIPELINE_TASK = AGENT_EVAL_TASKS.find(
  (task) => task.id === "pipeline-evidence"
)!;
const HUGE_TASK = AGENT_EVAL_TASKS.find(
  (task) => task.id === "huge-bundle-safety"
)!;
const API_TASK = AGENT_EVAL_TASKS.find(
  (task) => task.id === "api-response-link"
)!;

describe("agent grade eval core", () => {
  it("extracts compact observations from representative MCP tool outputs", () => {
    expect(
      extractToolObservations(
        "suggest-js-seeds",
        JSON.stringify({
          items: [
            { kind: "endpoint", nodeId: "js:1", analysisMode: "ast" },
            { kind: "selector", nodeId: "js:2", analysisMode: "text-scan" }
          ]
        })
      )
    ).toEqual(
      expect.objectContaining({
        resultItemCount: 2,
        seedKinds: ["endpoint", "selector"],
        hasNodeId: true,
        analysisModes: ["ast", "text-scan"]
      })
    );

    expect(
      extractToolObservations(
        "trace-js-pipeline",
        JSON.stringify({
          items: [
            {
              confidence: "high",
              analysisMode: "ast",
              steps: [{ kind: "handler" }, { kind: "endpoint" }]
            }
          ]
        })
      )
    ).toEqual(
      expect.objectContaining({
        traceConfidence: ["high"],
        traceStepKinds: ["handler", "endpoint"],
        analysisModes: ["ast"]
      })
    );

    expect(
      extractToolObservations(
        "read-api-response",
        JSON.stringify({
          fixtureDir: "fixture",
          bodyPath: "body.json",
          body: { truncated: true }
        })
      )
    ).toEqual(
      expect.objectContaining({
        readTruncated: true,
        apiResponseMetadata: true
      })
    );

    expect(
      extractToolObservations(
        "analyze-js-file",
        JSON.stringify({
          analysisMode: "text-scan",
          parse: { skipped: true, reason: "file-too-large" }
        })
      )
    ).toEqual(
      expect.objectContaining({
        analysisModes: ["text-scan"],
        parseSkippedReason: "file-too-large"
      })
    );
  });

  it("records argument shape without argument values", () => {
    expect(
      sanitizeArgumentShape({
        path: "/private/root/captured.js",
        limit: 5,
        kinds: ["endpoint", "selector"],
        options: { nested: true }
      })
    ).toEqual({
      kinds: "array(2)",
      limit: "number",
      options: "object(1)",
      path: "string"
    });
  });

  it("scores complete evidence chains highly", () => {
    const report = makeReport({
      toolEvents: [
        event("list-sites"),
        event("list-files"),
        event("suggest-js-seeds", {
          seedKinds: ["endpoint", "selector"],
          hasNodeId: true
        })
      ],
      finalText:
        "Evidence chain found. Bounded context was preserved. Recommended next step is tracing the selected node."
    });

    const score = scoreTaskRun(report, SEED_TASK);
    expect(score.total).toBeGreaterThanOrEqual(90);
    expect(score.evidenceStatus).toBe("2/2");
    expect(score.requiredToolsUsed).toBe("3/3");
  });

  it("caps shallow runs that skip the required evidence chain", () => {
    const report = makeReport({
      toolEvents: [event("list-sites"), event("list-files")],
      finalText:
        "This is a confident summary with recommendations, but it has no trace evidence or bounded symbol read."
    });

    const score = scoreTaskRun(report, PIPELINE_TASK);
    expect(score.total).toBeLessThan(70);
    expect(score.evidenceStatus).toBe("0/4");
    expect(score.requiredToolsUsed).toBe("0/3");
  });

  it("classifies tool-starved weak-agent runs", () => {
    const score = scoreTaskRun(
      makeReport({
        toolEvents: [
          event("list-sites", {}, { bytesSentToModel: 2, returnedBytes: 2 })
        ],
        finalText: "No evidence was gathered."
      }),
      PIPELINE_TASK
    );

    expect(score.failureCategories).toEqual(
      expect.arrayContaining([
        "tool-starved",
        "missing-required-tools",
        "missing-evidence",
        "missing-bounded-read"
      ])
    );
    expect(score.nextActionHints.join(" ")).toContain("semantic/search/read");
  });

  it("classifies repeated tool loops", () => {
    const score = scoreTaskRun(
      makeReport({
        toolEvents: [
          event("list-sites", {}, { bytesSentToModel: 2, returnedBytes: 2 }),
          event("list-sites", {}, { bytesSentToModel: 2, returnedBytes: 2 }),
          event("list-sites", {}, { bytesSentToModel: 2, returnedBytes: 2 })
        ],
        finalText: "The model repeated discovery without evidence."
      }),
      HUGE_TASK
    );

    expect(score.failureCategories).toEqual(
      expect.arrayContaining(["tool-loop", "missing-text-scan"])
    );
  });

  it("classifies discovery-only runs that do not trace or read evidence", () => {
    const score = scoreTaskRun(
      makeReport({
        toolEvents: [
          event("suggest-js-seeds", {
            seedKinds: ["endpoint"],
            hasNodeId: true
          })
        ],
        finalText:
          "Evidence seed found, but the workflow stopped before trace or bounded read."
      }),
      PIPELINE_TASK
    );

    expect(score.failureCategories).toEqual(
      expect.arrayContaining(["discovery-only", "missing-bounded-read"])
    );
  });

  it("classifies unproductive traces", () => {
    const score = scoreTaskRun(
      makeReport({
        toolEvents: [
          event("suggest-js-seeds", {
            seedKinds: ["endpoint"],
            hasNodeId: true
          }),
          event("trace-js-pipeline", { resultItemCount: 0 })
        ],
        finalText:
          "Evidence seed was traced, but no pipeline evidence was found."
      }),
      PIPELINE_TASK
    );

    expect(score.failureCategories).toEqual(
      expect.arrayContaining(["trace-unproductive", "missing-bounded-read"])
    );
  });

  it("does not classify optional seed-discovery traces as unproductive", () => {
    const score = scoreTaskRun(
      makeReport({
        toolEvents: [
          event("list-sites"),
          event("list-files"),
          event("suggest-js-seeds", {
            seedKinds: ["endpoint"],
            hasNodeId: true
          }),
          event("trace-js-pipeline", { resultItemCount: 0 })
        ],
        finalText:
          "Evidence seeds were found. The optional exploratory trace had no candidates, but seed discovery succeeded."
      }),
      SEED_TASK
    );

    expect(score.failureCategories).not.toContain("trace-unproductive");
    expect(score.evidenceStatus).toBe("2/2");
  });

  it("classifies missing text-scan evidence for huge-bundle tasks", () => {
    const score = scoreTaskRun(
      makeReport({
        toolEvents: [
          event("list-files"),
          event("analyze-js-file"),
          event("read-file", { readTruncated: true })
        ],
        finalText:
          "A bounded read was performed, but huge-bundle degradation was not confirmed."
      }),
      HUGE_TASK
    );

    expect(score.failureCategories).toContain("missing-text-scan");
  });

  it("classifies missing API metadata for API-link tasks", () => {
    const score = scoreTaskRun(
      makeReport({
        toolEvents: [
          event("list-api-routes", { resultItemCount: 0 }),
          event("suggest-js-seeds", {
            seedKinds: ["endpoint"],
            hasNodeId: true
          }),
          event("trace-js-pipeline", {
            traceConfidence: ["low"],
            traceStepKinds: ["endpoint"]
          }),
          event("read-api-response", { readTruncated: false })
        ],
        finalText:
          "A trace and bounded read were performed, but no API metadata was connected."
      }),
      API_TASK
    );

    expect(score.failureCategories).toContain("missing-api-metadata");
  });

  it("classifies context-heavy runs without exposing private values", () => {
    const score = scoreTaskRun(
      makeReport({
        toolEvents: [
          event("list-sites", {}, { bytesSentToModel: 300 * 1024 }),
          event("list-files", {}, { bytesSentToModel: 300 * 1024 }),
          event(
            "suggest-js-seeds",
            {
              seedKinds: ["endpoint"],
              hasNodeId: true
            },
            { bytesSentToModel: 300 * 1024, truncatedForModel: true }
          )
        ],
        finalText:
          "Evidence chain found. Bounded context was preserved. Recommended next step is tracing."
      }),
      SEED_TASK
    );

    expect(score.failureCategories).toContain("context-heavy");
    expect(score.nextActionHints.join(" ")).not.toContain("/Users/person");
  });

  it("lowers scores when required tools are missing", () => {
    const complete = scoreTaskRun(
      makeReport({
        toolEvents: [
          event("list-sites"),
          event("list-files"),
          event("suggest-js-seeds", {
            seedKinds: ["endpoint"],
            hasNodeId: true
          })
        ],
        finalText:
          "Evidence chain found. Bounded context was preserved. Recommended next step is tracing."
      }),
      SEED_TASK
    );
    const missingTools = scoreTaskRun(
      makeReport({
        toolEvents: [
          event("suggest-js-seeds", {
            seedKinds: ["endpoint"],
            hasNodeId: true
          })
        ],
        finalText:
          "Evidence chain found. Bounded context was preserved. Recommended next step is tracing."
      }),
      SEED_TASK
    );

    expect(missingTools.requiredToolsUsed).toBe("1/3");
    expect(missingTools.total).toBeLessThan(complete.total);
  });

  it("sanitizes failed model runs and continues scoring", () => {
    const score = scoreTaskFailure(
      "provider/tiny-model",
      PIPELINE_TASK,
      new Error(
        "Failure in /Users/person/private-root for private.example.com with token abcdefghijklmnopqrstuvwxyzABCDEFG"
      )
    );

    expect(score.total).toBe(0);
    expect(score.error).toContain("[local-path]");
    expect(score.error).toContain("[origin]");
    expect(score.error).toContain("[token]");
    expect(score.failureCategories).toEqual(["runner-failure"]);
    expect(score.error).not.toContain("private.example.com");
  });

  it("renders aggregate markdown without raw private values", () => {
    const good = scoreTaskRun(
      makeReport({
        model: "provider/good",
        toolEvents: [
          event("suggest-js-seeds", {
            seedKinds: ["endpoint"],
            hasNodeId: true
          }),
          event("trace-js-pipeline", {
            traceConfidence: ["high"],
            traceStepKinds: ["handler", "endpoint"]
          }),
          event("read-js-symbol", { readTruncated: false })
        ],
        finalText:
          "Evidence trace found with bounded context and recommended next step."
      }),
      PIPELINE_TASK
    );
    const failed = scoreTaskFailure(
      "provider/tiny",
      PIPELINE_TASK,
      new Error(
        "private.example.com /Users/person/root abcdefghijklmnopqrstuvwxyzABCDEFG"
      )
    );

    const markdown = renderTaskScoreMarkdown({
      rootPath: "/Users/person/private-root",
      generatedAt: new Date("2026-04-28T00:00:00.000Z"),
      results: [
        { model: "provider/good", tasks: [good] },
        { model: "provider/tiny", tasks: [failed] }
      ]
    });

    expect(markdown).toContain("pipeline-evidence");
    expect(markdown).toContain("Evidence Chain");
    expect(markdown).toContain("## Failure Analysis");
    expect(markdown).toContain("runner-failure");
    expect(markdown).not.toContain("/Users/person");
    expect(markdown).not.toContain("private.example.com");
    expect(markdown).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEFG");
  });
});

function event(
  tool: string,
  observations: SanitizedToolEvent["observations"] = {},
  options: Partial<
    Pick<
      SanitizedToolEvent,
      | "bytesSentToModel"
      | "durationMs"
      | "ok"
      | "returnedBytes"
      | "truncatedForModel"
    >
  > = {}
): SanitizedToolEvent {
  const returnedBytes =
    options.returnedBytes ?? options.bytesSentToModel ?? 1000;
  const bytesSentToModel = options.bytesSentToModel ?? returnedBytes;
  return {
    step: 1,
    tool,
    ok: options.ok ?? true,
    durationMs: options.durationMs ?? 5,
    returnedBytes,
    bytesSentToModel,
    truncatedForModel: options.truncatedForModel ?? false,
    argumentShape: {},
    observations
  };
}

function makeReport({
  model = "provider/model",
  toolEvents,
  finalText
}: {
  model?: string;
  toolEvents: SanitizedToolEvent[];
  finalText: string;
}): RunReport {
  return {
    name: "agent-grade-llm",
    taskId: "test-task",
    model,
    rootHash: "root",
    elapsedMs: 1000,
    maxSteps: 5,
    completed: true,
    finalText,
    redactedTerms: 0,
    totals: {
      modelCalls: 1,
      toolCalls: toolEvents.length,
      toolReturnedBytes: toolEvents.reduce(
        (total, toolEvent) => total + toolEvent.returnedBytes,
        0
      ),
      toolBytesSentToModel: toolEvents.reduce(
        (total, toolEvent) => total + toolEvent.bytesSentToModel,
        0
      ),
      truncatedToolResults: toolEvents.filter(
        (toolEvent) => toolEvent.truncatedForModel
      ).length
    },
    toolMetrics: toolEvents,
    toolEvents
  };
}

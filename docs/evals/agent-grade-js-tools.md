---
title: Agent-Grade JS Inspection Eval
---

# Agent-Grade JS Inspection Eval

Updated: 2026-04-29T02:15:15.676Z

This score is generated from opt-in private capture roots. The checked-in markdown stores only aggregate metrics, model ids, task ids, and a hashed corpus id; raw reports stay outside the repo by default.

Current score: **92/100 (A)**

Corpus hash: `75178824e4a4d05a`
Raw JSON reports are written outside the repo by default.

## Model Scores

| Model                          |  Score | Grade | Completed Tasks | Tool Calls | Bytes To Model | Truncated Tool Results | Elapsed |
| ------------------------------ | -----: | :---: | :-------------: | ---------: | -------------: | ---------------------: | ------: |
| `anthropic/claude-opus-4.7`    | 92/100 |   A   |       4/4       |         22 |      212.0 KiB |                      3 |  224.9s |
| `deepseek/deepseek-v3.2`       | 92/100 |   A   |       4/4       |         51 |      595.8 KiB |                     13 |  158.5s |
| `google/gemini-2.0-flash-lite` | 90/100 |   A   |       4/4       |         31 |      314.1 KiB |                      6 |   51.3s |
| `mistral/ministral-3b`         | 89/100 |   B   |       4/4       |         18 |      162.8 KiB |                      2 |   34.8s |
| `openai/gpt-4o-mini`           | 35/100 |   F   |       4/4       |         12 |        1.6 KiB |                      0 |   36.2s |

## Task Scores

| Model                          | Task                 |   Score | Grade | Required Tools | Evidence Chain | Bytes To Model | Truncations | Elapsed |
| ------------------------------ | -------------------- | ------: | :---: | :------------: | :------------: | -------------: | ----------: | ------: |
| `deepseek/deepseek-v3.2`       | `seed-discovery`     | 100/100 |   A   |      3/3       |      2/2       |      318.1 KiB |           8 |   50.5s |
| `google/gemini-2.0-flash-lite` | `pipeline-evidence`  | 100/100 |   A   |      3/3       |      4/4       |       30.8 KiB |           0 |    9.4s |
| `mistral/ministral-3b`         | `pipeline-evidence`  | 100/100 |   A   |      3/3       |      4/4       |       32.6 KiB |           1 |   11.9s |
| `mistral/ministral-3b`         | `seed-discovery`     | 100/100 |   A   |      3/3       |      2/2       |       48.9 KiB |           0 |    6.7s |
| `anthropic/claude-opus-4.7`    | `pipeline-evidence`  |  98/100 |   A   |      3/3       |      4/4       |       56.6 KiB |           1 |   57.1s |
| `google/gemini-2.0-flash-lite` | `seed-discovery`     |  96/100 |   A   |      3/3       |      2/2       |      149.9 KiB |           3 |   17.7s |
| `anthropic/claude-opus-4.7`    | `huge-bundle-safety` |  92/100 |   A   |      2/3       |      2/2       |       82.7 KiB |           2 |   62.5s |
| `anthropic/claude-opus-4.7`    | `seed-discovery`     |  92/100 |   A   |      2/3       |      2/2       |       36.5 KiB |           0 |   40.9s |
| `deepseek/deepseek-v3.2`       | `huge-bundle-safety` |  92/100 |   A   |      2/3       |      2/2       |      126.7 KiB |           4 |   29.3s |
| `deepseek/deepseek-v3.2`       | `pipeline-evidence`  |  92/100 |   A   |      2/3       |      4/4       |      100.8 KiB |           1 |   32.8s |
| `mistral/ministral-3b`         | `huge-bundle-safety` |  90/100 |   A   |      2/3       |      2/2       |       60.0 KiB |           1 |    8.5s |
| `google/gemini-2.0-flash-lite` | `huge-bundle-safety` |  88/100 |   B   |      2/3       |      2/2       |       59.9 KiB |           1 |   11.2s |
| `anthropic/claude-opus-4.7`    | `api-response-link`  |  84/100 |   B   |      3/4       |      3/4       |       36.3 KiB |           0 |   64.4s |
| `deepseek/deepseek-v3.2`       | `api-response-link`  |  82/100 |   B   |      3/4       |      3/4       |       50.2 KiB |           0 |   46.0s |
| `google/gemini-2.0-flash-lite` | `api-response-link`  |  76/100 |   C   |      2/4       |      3/4       |       73.5 KiB |           2 |   13.1s |
| `mistral/ministral-3b`         | `api-response-link`  |  64/100 |   D   |      3/4       |      1/4       |       21.3 KiB |           0 |    7.7s |
| `openai/gpt-4o-mini`           | `api-response-link`  |  39/100 |   F   |      1/4       |      0/4       |        1.6 KiB |           0 |   13.5s |
| `openai/gpt-4o-mini`           | `seed-discovery`     |  37/100 |   F   |      1/3       |      0/2       |            2 B |           0 |    4.3s |
| `openai/gpt-4o-mini`           | `huge-bundle-safety` |  31/100 |   F   |      0/3       |      0/2       |           10 B |           0 |   13.4s |
| `openai/gpt-4o-mini`           | `pipeline-evidence`  |  31/100 |   F   |      0/3       |      0/4       |            2 B |           0 |    5.0s |

## Failure Analysis

Categories and next actions are derived only from sanitized tool-event metadata.

| Model                          | Task                 | Categories                                                                                                                           | Next Action                                                                                                                                |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `deepseek/deepseek-v3.2`       | `seed-discovery`     | `context-heavy`                                                                                                                      | prefer narrower seed filters and node-id reads before broad listing                                                                        |
| `anthropic/claude-opus-4.7`    | `huge-bundle-safety` | `missing-required-tools`                                                                                                             | call the task-required MCP tools instead of ending with prose                                                                              |
| `anthropic/claude-opus-4.7`    | `seed-discovery`     | `missing-required-tools`                                                                                                             | call the task-required MCP tools instead of ending with prose                                                                              |
| `deepseek/deepseek-v3.2`       | `huge-bundle-safety` | `missing-required-tools`                                                                                                             | call the task-required MCP tools instead of ending with prose                                                                              |
| `deepseek/deepseek-v3.2`       | `pipeline-evidence`  | `missing-required-tools`, `discovery-only`                                                                                           | call the task-required MCP tools instead of ending with prose; after seed discovery, trace the selected node id and read bounded evidence  |
| `mistral/ministral-3b`         | `huge-bundle-safety` | `missing-required-tools`                                                                                                             | call the task-required MCP tools instead of ending with prose                                                                              |
| `google/gemini-2.0-flash-lite` | `huge-bundle-safety` | `missing-required-tools`                                                                                                             | call the task-required MCP tools instead of ending with prose                                                                              |
| `anthropic/claude-opus-4.7`    | `api-response-link`  | `tool-loop`, `missing-required-tools`, `missing-evidence`, `missing-api-metadata`                                                    | switch to the next workflow step when repeated calls add no evidence; call the task-required MCP tools instead of ending with prose        |
| `deepseek/deepseek-v3.2`       | `api-response-link`  | `tool-loop`, `missing-required-tools`, `missing-evidence`, `missing-api-metadata`                                                    | switch to the next workflow step when repeated calls add no evidence; call the task-required MCP tools instead of ending with prose        |
| `google/gemini-2.0-flash-lite` | `api-response-link`  | `missing-required-tools`, `missing-evidence`, `missing-api-metadata`                                                                 | call the task-required MCP tools instead of ending with prose; continue until every task evidence observation is present                   |
| `mistral/ministral-3b`         | `api-response-link`  | `missing-required-tools`, `missing-evidence`, `discovery-only`, `trace-unproductive`, `missing-bounded-read`, `missing-api-metadata` | call the task-required MCP tools instead of ending with prose; continue until every task evidence observation is present                   |
| `openai/gpt-4o-mini`           | `api-response-link`  | `tool-starved`, `tool-loop`, `missing-required-tools`, `missing-evidence`, `missing-bounded-read`, `missing-api-metadata`            | start with discovery, then make a concrete semantic/search/read call; switch to the next workflow step when repeated calls add no evidence |
| `openai/gpt-4o-mini`           | `seed-discovery`     | `tool-starved`, `missing-required-tools`, `missing-evidence`                                                                         | start with discovery, then make a concrete semantic/search/read call; call the task-required MCP tools instead of ending with prose        |
| `openai/gpt-4o-mini`           | `huge-bundle-safety` | `tool-starved`, `tool-loop`, `missing-required-tools`, `missing-evidence`, `missing-bounded-read`, `missing-text-scan`               | start with discovery, then make a concrete semantic/search/read call; switch to the next workflow step when repeated calls add no evidence |
| `openai/gpt-4o-mini`           | `pipeline-evidence`  | `tool-starved`, `missing-required-tools`, `missing-evidence`, `missing-bounded-read`                                                 | start with discovery, then make a concrete semantic/search/read call; call the task-required MCP tools instead of ending with prose        |

## Rubric

| Component                | Max | What It Measures                                                                                                                |
| ------------------------ | --: | ------------------------------------------------------------------------------------------------------------------------------- |
| Evidence Chain           |  40 | The task produced required observations such as seeds, node ids, traces, bounded reads, API metadata, or text-scan degradation. |
| Required Tool Use        |  25 | The model used the MCP tools expected for the task instead of stopping at a summary.                                            |
| Context Safety           |  15 | The model stayed within bounded tool output and respected truncation/large-file behavior.                                       |
| Tool Reliability         |  10 | MCP tool calls succeeded without validation or runtime errors.                                                                  |
| Final Assessment Quality |  10 | The final task answer was useful and privacy-preserving.                                                                        |

If a task lacks enough evidence-chain observations, the task score is capped below pass level even when the final prose sounds plausible.

## Component Breakdown

### deepseek/deepseek-v3.2 / seed-discovery

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  40/40 | 2/2 evidence requirements met  |
| Required Tool Use        |  25/25 | 3/3 required tools used        |
| Context Safety           |  15/15 | 318.1 KiB sent to model        |
| Tool Reliability         |  10/10 | 17/17 tool calls succeeded     |
| Final Assessment Quality |  10/10 | model returned task assessment |

### google/gemini-2.0-flash-lite / pipeline-evidence

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  40/40 | 4/4 evidence requirements met  |
| Required Tool Use        |  25/25 | 3/3 required tools used        |
| Context Safety           |  15/15 | 30.8 KiB sent to model         |
| Tool Reliability         |  10/10 | 5/5 tool calls succeeded       |
| Final Assessment Quality |  10/10 | model returned task assessment |

### mistral/ministral-3b / pipeline-evidence

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  40/40 | 4/4 evidence requirements met  |
| Required Tool Use        |  25/25 | 3/3 required tools used        |
| Context Safety           |  15/15 | 32.6 KiB sent to model         |
| Tool Reliability         |  10/10 | 4/4 tool calls succeeded       |
| Final Assessment Quality |  10/10 | model returned task assessment |

### mistral/ministral-3b / seed-discovery

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  40/40 | 2/2 evidence requirements met  |
| Required Tool Use        |  25/25 | 3/3 required tools used        |
| Context Safety           |  15/15 | 48.9 KiB sent to model         |
| Tool Reliability         |  10/10 | 5/5 tool calls succeeded       |
| Final Assessment Quality |  10/10 | model returned task assessment |

### anthropic/claude-opus-4.7 / pipeline-evidence

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  40/40 | 4/4 evidence requirements met  |
| Required Tool Use        |  25/25 | 3/3 required tools used        |
| Context Safety           |  15/15 | 56.6 KiB sent to model         |
| Tool Reliability         |  10/10 | 5/5 tool calls succeeded       |
| Final Assessment Quality |   8/10 | model returned task assessment |

### google/gemini-2.0-flash-lite / seed-discovery

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  40/40 | 2/2 evidence requirements met  |
| Required Tool Use        |  25/25 | 3/3 required tools used        |
| Context Safety           |  15/15 | 149.9 KiB sent to model        |
| Tool Reliability         |  10/10 | 16/16 tool calls succeeded     |
| Final Assessment Quality |   6/10 | model returned task assessment |

### anthropic/claude-opus-4.7 / huge-bundle-safety

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  40/40 | 2/2 evidence requirements met  |
| Required Tool Use        |  17/25 | 2/3 required tools used        |
| Context Safety           |  15/15 | 82.7 KiB sent to model         |
| Tool Reliability         |  10/10 | 7/7 tool calls succeeded       |
| Final Assessment Quality |  10/10 | model returned task assessment |

### anthropic/claude-opus-4.7 / seed-discovery

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  40/40 | 2/2 evidence requirements met  |
| Required Tool Use        |  17/25 | 2/3 required tools used        |
| Context Safety           |  15/15 | 36.5 KiB sent to model         |
| Tool Reliability         |  10/10 | 3/3 tool calls succeeded       |
| Final Assessment Quality |  10/10 | model returned task assessment |

### deepseek/deepseek-v3.2 / huge-bundle-safety

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  40/40 | 2/2 evidence requirements met  |
| Required Tool Use        |  17/25 | 2/3 required tools used        |
| Context Safety           |  15/15 | 126.7 KiB sent to model        |
| Tool Reliability         |  10/10 | 9/9 tool calls succeeded       |
| Final Assessment Quality |  10/10 | model returned task assessment |

### deepseek/deepseek-v3.2 / pipeline-evidence

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  40/40 | 4/4 evidence requirements met  |
| Required Tool Use        |  17/25 | 2/3 required tools used        |
| Context Safety           |  15/15 | 100.8 KiB sent to model        |
| Tool Reliability         |  10/10 | 7/7 tool calls succeeded       |
| Final Assessment Quality |  10/10 | model returned task assessment |

### mistral/ministral-3b / huge-bundle-safety

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  40/40 | 2/2 evidence requirements met  |
| Required Tool Use        |  17/25 | 2/3 required tools used        |
| Context Safety           |  15/15 | 60.0 KiB sent to model         |
| Tool Reliability         |  10/10 | 4/4 tool calls succeeded       |
| Final Assessment Quality |   8/10 | model returned task assessment |

### google/gemini-2.0-flash-lite / huge-bundle-safety

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  40/40 | 2/2 evidence requirements met  |
| Required Tool Use        |  17/25 | 2/3 required tools used        |
| Context Safety           |  15/15 | 59.9 KiB sent to model         |
| Tool Reliability         |  10/10 | 5/5 tool calls succeeded       |
| Final Assessment Quality |   6/10 | model returned task assessment |

### anthropic/claude-opus-4.7 / api-response-link

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  30/40 | 3/4 evidence requirements met  |
| Required Tool Use        |  19/25 | 3/4 required tools used        |
| Context Safety           |  15/15 | 36.3 KiB sent to model         |
| Tool Reliability         |  10/10 | 7/7 tool calls succeeded       |
| Final Assessment Quality |  10/10 | model returned task assessment |

### deepseek/deepseek-v3.2 / api-response-link

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  30/40 | 3/4 evidence requirements met  |
| Required Tool Use        |  19/25 | 3/4 required tools used        |
| Context Safety           |  15/15 | 50.2 KiB sent to model         |
| Tool Reliability         |  10/10 | 18/18 tool calls succeeded     |
| Final Assessment Quality |   8/10 | model returned task assessment |

### google/gemini-2.0-flash-lite / api-response-link

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  30/40 | 3/4 evidence requirements met  |
| Required Tool Use        |  13/25 | 2/4 required tools used        |
| Context Safety           |  15/15 | 73.5 KiB sent to model         |
| Tool Reliability         |  10/10 | 5/5 tool calls succeeded       |
| Final Assessment Quality |   8/10 | model returned task assessment |

### mistral/ministral-3b / api-response-link

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |  10/40 | 1/4 evidence requirements met  |
| Required Tool Use        |  19/25 | 3/4 required tools used        |
| Context Safety           |  15/15 | 21.3 KiB sent to model         |
| Tool Reliability         |  10/10 | 5/5 tool calls succeeded       |
| Final Assessment Quality |  10/10 | model returned task assessment |

### openai/gpt-4o-mini / api-response-link

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |   0/40 | 0/4 evidence requirements met  |
| Required Tool Use        |   6/25 | 1/4 required tools used        |
| Context Safety           |  15/15 | 1.6 KiB sent to model          |
| Tool Reliability         |  10/10 | 5/5 tool calls succeeded       |
| Final Assessment Quality |   8/10 | model returned task assessment |

### openai/gpt-4o-mini / seed-discovery

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |   0/40 | 0/2 evidence requirements met  |
| Required Tool Use        |   8/25 | 1/3 required tools used        |
| Context Safety           |  15/15 | 2 B sent to model              |
| Tool Reliability         |  10/10 | 1/1 tool calls succeeded       |
| Final Assessment Quality |   4/10 | model returned task assessment |

### openai/gpt-4o-mini / huge-bundle-safety

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |   0/40 | 0/2 evidence requirements met  |
| Required Tool Use        |   0/25 | 0/3 required tools used        |
| Context Safety           |  15/15 | 10 B sent to model             |
| Tool Reliability         |  10/10 | 5/5 tool calls succeeded       |
| Final Assessment Quality |   6/10 | model returned task assessment |

### openai/gpt-4o-mini / pipeline-evidence

| Component                | Points | Reason                         |
| ------------------------ | -----: | ------------------------------ |
| Evidence Chain           |   0/40 | 0/4 evidence requirements met  |
| Required Tool Use        |   0/25 | 0/3 required tools used        |
| Context Safety           |  15/15 | 2 B sent to model              |
| Tool Reliability         |  10/10 | 1/1 tool calls succeeded       |
| Final Assessment Quality |   6/10 | model returned task assessment |

## Findings

- Shallow completions are visible now: a model can finish the task prose but still miss the required evidence chain.
- Tool-starved failures show models stopping before they have enough MCP evidence to answer the task.
- Discovery-only failures show that seeds and node ids need to be followed by trace and bounded-read evidence.
- Some traces were unproductive, so agents need to retry with another discovered seed or a narrower path filter.
- Context-heavy runs are visible as a reporting risk even when the final task score remains strong.
- Truncated tool results remain common for deeper inspections, so compact previews and follow-up node ids are part of the agent-grade contract.
- Source maps are intentionally not part of the score; the eval rewards source-map-independent reconstruction.

## Interpretation

The near-term goal is not source-map recovery. Source maps are valuable when present, but the agent-grade bar is whether an agent can reconstruct useful execution evidence from minified or bundled captures using bounded semantic facts.

Recommended next direction: harden tool guidance and task-oriented affordances where weaker models stop after discovery instead of producing a seed-to-trace-to-snippet evidence chain.

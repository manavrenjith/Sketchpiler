Flowchart-to-Pseudocode App: Specification v0.1
Draft · October 10, 2026 · UI intentionally out of scope for this version
1. Overview
A small service that takes a photo of a hand-drawn flowchart and returns two things: a digital representation of the diagram (nodes, edges, flags for anything uncertain) and pseudocode generated from it.
The design rests on one split: a cloud vision model does the part that needs intelligence (reading the drawing), and plain deterministic code does everything else (parsing, validating, generating). The pseudocode step makes zero AI calls.
Goals
• G1. Accept an image of a hand-drawn flowchart.
• G2. Return a clean digital representation of it.
• G3. Generate pseudocode from that representation.
• G4. Run on a low-spec machine (no GPU, low RAM): all model inference is remote.
• G5. Keep the UI replaceable. v1 exposes an API and a throwaway test page only.
Non-goals for v1: ER and UML diagrams, local/self-hosted models, accounts and login, saved history, a polished UI, real-time collaboration, executing the generated code.
2. Primary flow
1. Client uploads an image.
2. Server validates and downsizes it.
3. A provider adapter sends it to a cloud vision model with a fixed prompt.
4. The model answers in a compact line format (the DSL, section 5).
5. The server parses the DSL into the digital representation and validates it.
6. The server returns the representation (plus a Mermaid string for rendering and any warnings).
7. The client calls generate (optionally after the user corrects the representation) and receives pseudocode.
Step 7 takes the representation as input, not the image. That keeps generation deterministic and lets a future UI insert a human review step between extraction and generation without changing the API.
3. Functional requirements
FR-1 Image intake
• Accept JPEG, PNG and WebP. Maximum upload 10 MB.
• Check the real file type, not just the extension. Reject anything else with a clear error.
• Downscale before sending to the model: long side about 1600 px, re-encoded as JPEG. Keep nothing on disk after the request ends (see NFR-5).
FR-2 Extraction
• Send the image and the fixed extraction prompt (section 6) to the configured provider.
• Temperature 0, max_tokens 2000 (increased from 800 to provide headroom so model thinking/reasoning tokens do not crowd out output text).
• Provider is chosen by configuration, never hard-coded (FR-7).
FR-3 Digital representation
• Parse the model's DSL output into the representation (section 7).
• Be tolerant of messy output: strip code fences and stray prose, skip bad lines with a warning, drop a truncated final line and set truncated: true.
• Include uncertain flags for nodes and edges the model marked as unsure.
• Also return a Mermaid flowchart string built from the representation, so any client can render it.
FR-4 Validation
• Exactly one start; at least one end.
• Every dec node has at least two outgoing edges.
• No orphan nodes (unreachable from start); no edges to unknown nodes.
• Validation problems become warnings with node ids, not hard failures, unless the graph is empty.
• Confidence is computed by the server from warnings and uncertain flags. The model is never asked for a score.
FR-5 Pseudocode generation
• Input: a representation (as returned by extraction, or edited by a client).
• Output: pseudocode text plus warnings.
• Fully deterministic: same input, same output. No AI calls.
• Rules are in section 8.
FR-6 Errors
Every failure returns a machine-readable code and a plain message. At minimum: invalid_image, too_large, provider_rate_limited, provider_error, output_truncated, unparseable_output, empty_diagram.
FR-7 Provider adapters
• One small interface: take an image plus the prompt, return raw text and a stop reason.
• Adapters hold no format logic. The prompt, the parser and the image handling are shared by all providers.
• v1 ships with one provider and is built so a second is a single new file. Candidates include Groq and Gemini.
• On HTTP 429, honour retry-after when present, otherwise back off exponentially, with at most 3 retries, then return provider_rate_limited.
• On HTTP 500, 502, 503 and 504, retry with the same exponential backoff and retry-after support (at most 3 retries); after the last retry, return provider_error indicating the provider is temporarily unavailable. Never retry 400, 401, 403 or 404.
4. API (v1)
All responses are JSON. No authentication in v1 (deploy privately or behind a simple key).
Method and path
Purpose
POST /api/extract
Multipart image in, representation out
POST /api/generate
Representation in, pseudocode out
POST /api/convert
Convenience: image in, representation and pseudocode out
GET /api/health
Liveness, and which provider is configured
POST /api/extract success response (shape)
{
  "representation": {
    "type": "flowchart",
    "nodes": [{ "id": "N1", "type": "start", "text": "Start", "uncertain": false }],
    "edges": [{ "from": "N1", "to": "N2", "label": null, "uncertain": false }]
  },
  "mermaid": "flowchart TD ...",
  "warnings": [],
  "truncated": false,
  "confidence": 0.9,
  "provider": "groq"
}
5. Model output format (the DSL)
The model returns lines of text, not JSON. This is far smaller, survives truncation (every complete line still parses) and avoids bracket and comma errors.
flowchart
N<int> <type> "<text>" [~]
E N<int> N<int> ["<label>"] [~]
• Types: start, end (terminators), proc (rectangle), io (parallelogram), dec (diamond).
• Text is double-quoted; inner quotes are escaped as \", but the parser also accepts unescaped inner quotes.
• Multi-line shape text is joined with ; .
• Edges run from arrow tail to arrowhead. Loop-backs are ordinary edges.
• Duplicate texts are allowed (for example two End boxes); ids are unique.
• A trailing ~ means the model was unsure about that line.
• The header flowchart is required. er and uml are reserved for later and must be rejected clearly for now.
6. Extraction prompt (summary of requirements)
The full prompt lives in one shared module. It must: state the format and the type vocabulary, require reading-order numbering, require copying text exactly, require checking every arrowhead, forbid inventing shapes, arrows or labels, define the ~ marker, and include one small worked example (marked as format-only so it is not copied). Image-specific hints (ignore the table and fabric around the paper) belong here too.
7. Digital representation
A graph of nodes and edges, as in the example in section 4.
• Node fields: id, type, text, uncertain.
• Edge fields: from, to, label (Yes/No/True/False or null), uncertain.
• The representation is the contract between extraction and generation, and the only thing a future UI needs to edit.
• Version it ("schemaVersion": 1) from the start.
8. Pseudocode generation rules
Style (v1 default): plain keywords: INPUT, OUTPUT, IF ... THEN / ELSE / END IF, WHILE ... DO / END WHILE. Two-space indentation.
Mapping
• io nodes starting with Input/Read become INPUT x; those starting with Display/Print/Output become OUTPUT x; any other io text is kept as written.
• proc text is kept verbatim as a statement. The generator does not rewrite or interpret expressions. A ; separates statements; a comma separates statements only if every part is an assignment.
• dec with a branch that eventually returns to the decision (a back-edge) becomes WHILE; dec whose branches meet again later becomes IF/ELSE; dec whose branches end separately becomes IF/ELSE with each branch running to its own end.
• Branches are chosen by edge label (Yes/True versus No/False). An unlabelled decision gets a warning and a default assignment.
• Anything the generator cannot structure (for example arrows jumping into the middle of a loop) is emitted as labelled steps with GOTO, together with a warning. It never silently drops nodes.
Worked example (sum of 1..n)
INPUT n
sum = 0
i = 1
WHILE i <= n DO
  sum = sum + i
  i = i + 1
END WHILE
OUTPUT sum
9. Non-functional requirements
• NFR-1 Performance: target under 15 seconds end to end for one typical photo, most of it provider time. Generation alone is effectively instant.
• NFR-2 Cost and limits: downscale images, short prompt, max_tokens about 800, cache nothing sensitive. Stay inside free-tier limits for development.
• NFR-3 Resilience: handle 429s, truncation and malformed output without crashing. Every failure maps to an error code (FR-6).
• NFR-4 Portability: runs on a low-spec laptop with no GPU. No local model is required.
• NFR-5 Privacy: uploaded images are processed in memory and not stored. Logs contain request ids, timings and error codes, never image data or diagram text. Free provider tiers may use submitted data, so document which provider is configured and avoid sensitive diagrams on free tiers.
• NFR-6 Replaceable UI: all functionality is reachable through the API. The bundled upload page is a placeholder.
• NFR-7 Testability: parser and generator are pure functions covered by golden tests (section 11).
10. Suggested stack (proposal, not fixed)
• Backend: TypeScript on Node with a small HTTP framework. Stateless, no database in v1.
• Parser, validator and generator as pure modules with no network access.
• Provider adapters in their own folder, one file each.
• Placeholder UI: one static HTML page with an upload box, a rendered diagram and a pseudocode panel.
• Configuration through environment variables: provider name, API key, model name, max upload size.
11. Testing and acceptance
Golden tests (no AI needed): fixed DSL in, expected representation and expected pseudocode out. Cases: straight sequence, if/else with a shared end, if/else with separate ends, while loop with a loop-back edge, duplicate End nodes, unescaped inner quotes, code-fenced output, truncated final line, unknown node in an edge, unknown header, empty output.
Evaluation set: four hand-drawn photos (sum of n, odd or even, largest of three, reverse a number) with hand-written answer keys, run through the real provider by the evaluation script.
Proposed acceptance targets (to be calibrated after the first real run):
• Golden tests: 100% pass.
• On the evaluation set: at least 3 of 4 diagrams need 2 or fewer corrections to the representation.
• Pseudocode for each corrected representation matches the expected output exactly.
• No unhandled crash on any malformed model output in the test list.
12. Milestones
1. M1 Core without AI: DSL parser, validator, Mermaid builder, pseudocode generator, golden tests.
2. M2 Extraction: provider adapter, shared prompt, image intake and downscaling, /api/extract.
3. M3 Evaluation: run the four-photo set, record corrections per diagram, tune the prompt.
4. M4 Hardening: retries and backoff, truncation handling, error codes, second provider, /api/convert.
5. M5 UI (later): review and edit screen between extraction and generation, built on the existing API.
13. Risks and open questions
• Arrow direction and loop-backs are the most likely extraction errors. Mitigation: the ~ marker, validation warnings, and a review step in the later UI.
• Handwriting quality and photo conditions vary. Mitigation: cropping and contrast guidance for users, and downscaling.
• Free-tier rate limits may block testing. Mitigation: retries, spacing requests, a second provider, or a small paid tier.
• Unstructured flow (jumps into the middle of loops) cannot always be turned into clean WHILE/IF. The GOTO fallback with a warning is the v1 answer.
Open questions
1. Which provider is the default for v1?
2. Should the pseudocode style be configurable (plain keywords, Python-like, C-like)?
3. Does v1 need a human review step in the API flow, or only the editable representation?
4. Where will it be hosted, and is a simple access key enough?
5. Should extraction retry once automatically when validation fails badly (for example no start node)?
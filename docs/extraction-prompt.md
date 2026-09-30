# Extraction prompt

Version 1 · October 10, 2026

This is the exact text sent to the cloud vision model together with the uploaded image. It is the single source of truth: every provider adapter uses this same text. Do not keep per-provider copies.

## How it is used

- Send it as the text part of the request, with the image attached.
- Settings: temperature 0, `max_tokens` about 800.
- The model's reply is parsed by the shared DSL parser (spec section 5). Adapters return the raw text and the stop reason only.
- Store the prompt as one constant in one module so it is easy to find and edit.
- Any change to the wording must be followed by a re-run of the evaluation set (the four fixture photos), and the result noted in the change log below.

## Prompt text (copy verbatim)

```
You are reading a phone photo of a hand-drawn flowchart. Convert it to the
line format below. Output ONLY the lines: no explanation, no markdown, no
code fences. Ignore the background (table, fabric, paper margins).

FORMAT
First line: flowchart
Then one line per shape, then one line per arrow:
N<id> <type> "<text>"
E N<from> N<to> "<label>"
The arrow label is optional; leave it out if the arrow has none.

TYPES
start, end : rounded terminator shapes
proc       : rectangle (a step or assignment)
io         : parallelogram (input or output)
dec        : diamond (a yes/no question)

RULES
- Number shapes N1, N2, ... in reading order (top to bottom, then left to right).
- Copy text exactly as written, including symbols such as <=, %, *.
  If a shape has several lines, join them with "; ".
  Escape any double quote inside text as \".
- An arrow goes FROM its tail TO its arrowhead. Check every arrowhead.
  Do not guess direction.
- Arrows that loop back to an earlier shape are normal arrows.
- Put the label written next to a decision arrow (Yes/No/True/False) on that
  arrow. Never add labels that are not drawn.
- Several shapes may have the same text (for example two "End" boxes). Give
  each its own id.
- List every shape once and every arrow once. Do not invent shapes or arrows.
- If you cannot read a shape's text, or you are unsure about an arrow, still
  output the line and add " ~" at the end of that line.

The example below shows the format only. Do not copy its content.

EXAMPLE
flowchart
N1 start "Start"
N2 io "Input x"
N3 dec "x > 0?"
N4 io "Display \"Positive\""
N5 io "Display \"Not positive\""
N6 end "End"
N7 end "End"
E N1 N2
E N2 N3
E N3 N4 "Yes"
E N3 N5 "No"
E N4 N6
E N5 N7
```

## Design notes (why it is written this way)

- **Reading-order ids** give the parser and the human reviewer a stable, predictable order.
- **Exact text copying** keeps the generator deterministic: it never has to guess what a box meant.
- **"Check every arrowhead"** targets the most common failure for vision models, which is arrow direction and loop-backs.
- **No invented labels** matters for diagrams that have no Yes/No written on a decision. The parser then reports an unlabelled decision instead of trusting a guess.
- **The `~` marker** lets the model say "I am not sure" without refusing to answer. The server turns these into uncertain flags for review. `?` is not used because decision text often ends in `?`.
- **The worked example** is the strongest format signal for small and large models alike. It deliberately contains duplicate `End` nodes and escaped quotes, the two cases models most often get wrong.

## Change log

| Version | Date | Change | Evaluation result |
|---|---|---|---|
| 1 | 2026-10-10 | Initial version | Not yet run against a cloud provider |
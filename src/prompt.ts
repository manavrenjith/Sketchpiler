// Vision model prompt instructing the AI how to transcribe hand-drawn flowcharts.
export const EXTRACTION_PROMPT = `You are reading a phone photo of a hand-drawn flowchart. Convert it to the
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
  Escape any double quote inside text as \\".
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
N4 io "Display \\"Positive\\""
N5 io "Display \\"Not positive\\""
N6 end "End"
N7 end "End"
E N1 N2
E N2 N3
E N3 N4 "Yes"
E N3 N5 "No"
E N4 N6
E N5 N7`;

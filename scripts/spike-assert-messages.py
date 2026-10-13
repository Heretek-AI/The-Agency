#!/usr/bin/env python3
"""Assert the Stage 1a spike's model-produced markers in a session transcript.

Reads the raw body of `GET /api/session/{sessionID}/message` on stdin and
checks two things:

- the shell marker `spike-shell-ok` appears in genuine shell run output:
  either the stdout (`output.output`) of a message with `"type": "shell"`,
  or the completed text of an assistant content part with `"type": "tool"`
  and `"name": "shell"` (its `state.content[]` text);
- a `## RESULT` heading followed by a fenced JSON block with a valid `status`
  appears in the text content of a message with `"type": "assistant"`.

Every other message type, in particular the `user` echo of the prompt, is
ignored: a prompt echo is not run output, so matching it would make these
assertions vacuous (the prompt text itself contains both markers).

Grounded in the OpenCode v2 reference clone
(review/opencode/packages/protocol/openapi.json, 2.0.26):
- `SessionMessagesResponse` is `{data: [Session.Message.Info], cursor}`;
- `Session.Message.Shell` is `{type: "shell", command, status, output?}` with
  stdout in `output.output` (id/time/shellID/command/status required, output
  optional while the command runs);
- `Session.Message.Assistant` is `{type: "assistant", content: [...]}` where
  text parts are `{type: "text", text}` and tool calls are
  `{type: "tool", name, state, ...}` with completed output in
  `state.content[]` text items;
- `Session.Message.User` is `{type: "user", text}` (top-level text, no
  content array).

Observed against the real 2.0.26 server (Stage 1a keyed runs): the `shell`
TOOL's output lands as an assistant `tool` part named `"shell"`, never as a
standalone `type: "shell"` message. Standalone shell messages are only
produced for background shells (`session.shell.started` in
review/opencode/packages/core/src/session/message-updater.ts). Both shapes
are genuine run output and both count; the user echo never does.

Exit codes: 0 both markers found; 1 a marker is missing (it names which);
2 the transcript cannot be parsed as the schema above. There is no tolerant
path: a transcript that does not parse fails this assertion.
"""

import json
import re
import sys

HEADING = re.compile(r"^##\s+RESULT\s*$", re.M)
FENCE = re.compile(r"```(?:json)?\s*\n([\s\S]*?)```")
STATUSES = ("done", "blocked", "needs-handoff", "needs-split")


def die(reason: str, code: int = 2) -> None:
    print(f"spike-assert-messages: FAIL {reason}", file=sys.stderr)
    sys.exit(code)


def main() -> int:
    try:
        doc = json.load(sys.stdin)
    except json.JSONDecodeError as err:
        die(f"transcript is not valid JSON: {err}")
    if not isinstance(doc, dict) or not isinstance(doc.get("data"), list):
        die("transcript is not SessionMessagesResponse {data: [...], cursor}")

    shell_outputs: list[str] = []
    assistant_parts: list[str] = []
    counts = {"user": 0, "assistant": 0, "shell": 0, "other": 0}
    tool_parts = 0
    for message in doc["data"]:
        if not isinstance(message, dict):
            die("message entry is not a JSON object")
        mtype = message.get("type")
        if mtype in counts:
            counts[mtype] += 1
        else:
            counts["other"] += 1
        if mtype == "shell":
            output = message.get("output")
            if output is None:
                continue
            if not isinstance(output, dict) or not isinstance(
                output.get("output"), str
            ):
                die("shell message has an output that is not {output: string}")
            shell_outputs.append(output["output"])
        elif mtype == "assistant":
            content = message.get("content")
            if not isinstance(content, list):
                die("assistant message has no content array")
            for part in content:
                if not isinstance(part, dict):
                    die("assistant content part is not a JSON object")
                if part.get("type") == "text":
                    if not isinstance(part.get("text"), str):
                        die("assistant text part has no string text")
                    assistant_parts.append(part["text"])
                elif part.get("type") == "tool":
                    tool_parts += 1
                    name = part.get("name")
                    if not isinstance(name, str):
                        die("assistant tool part has no string name")
                    state = part.get("state")
                    if not isinstance(state, dict):
                        die("assistant tool part has no state object")
                    if name != "shell":
                        continue
                    content_items = state.get("content")
                    if content_items is None:
                        continue
                    if not isinstance(content_items, list):
                        die("assistant shell tool part has content that is not a list")
                    for item in content_items:
                        if not isinstance(item, dict):
                            die(
                                "assistant shell tool content item is not a JSON object"
                            )
                        if item.get("type") == "text":
                            if not isinstance(item.get("text"), str):
                                die("assistant shell tool text item has no string text")
                            shell_outputs.append(item["text"])

    missing: list[str] = []
    if not any("spike-shell-ok" in out for out in shell_outputs):
        missing.append(
            "shell marker spike-shell-ok in shell run output "
            "(a shell message output.output or an assistant shell tool part)"
        )
    result_text = "\n".join(assistant_parts)
    headings = list(HEADING.finditer(result_text))
    if not headings:
        missing.append("## RESULT heading in assistant text content")
    else:
        after = result_text[headings[-1].end() :]
        fence = FENCE.search(after)
        if fence is None:
            missing.append("fenced JSON block after the ## RESULT heading")
        else:
            try:
                block = json.loads(fence.group(1).strip())
            except json.JSONDecodeError as err:
                missing.append(f"parseable JSON in the ## RESULT block: {err}")
            else:
                if not isinstance(block, dict) or block.get("status") not in STATUSES:
                    missing.append(f"RESULT status one of {', '.join(STATUSES)}")
    if missing:
        summary = ", ".join(f"{n} {t}" for t, n in counts.items() if n)
        if tool_parts:
            summary += f"; {tool_parts} assistant tool parts"
        die(
            "missing " + "; ".join(missing) + f" [transcript: {summary}; "
            "user-role messages are ignored, not run output]",
            code=1,
        )

    print(
        "spike-assert-messages: PASS spike-shell-ok in shell run output; "
        "## RESULT block in assistant text"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

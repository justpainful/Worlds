#!/bin/sh
IFS= read -r input || exit 2
printf '%s\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"Fixture answer"},{"type":"tool_use","name":"mcp__worlds__pages_read","input":{"id":"local"}}]}}'
printf '%s\n' '{"type":"user","message":{"content":[{"type":"tool_result","is_error":false}]}}'
printf '%s\n' '{"type":"result","result":"Fixture answer","is_error":false}'

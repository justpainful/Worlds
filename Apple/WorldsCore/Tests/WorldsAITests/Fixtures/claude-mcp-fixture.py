#!/usr/bin/python3
"""Synthetic provider for the isolated MCP transport test only."""
import json
import subprocess
import sys

args = sys.argv[1:]
def value(flag):
    return args[args.index(flag) + 1]

if value('--tools') != '' or value('--allowedTools') != 'mcp__worlds':
    sys.exit(2)
config = json.load(open(value('--mcp-config'), encoding='utf-8'))
server = config['mcpServers']['worlds']
if server['args'][:3] != ['--mcp', '--actor', 'ai']:
    sys.exit(3)
prompt = json.loads(sys.stdin.readline())
if prompt['message']['content'][0]['text'] != 'synthetic fixture':
    sys.exit(4)
proc = subprocess.Popen([server['command'], *server['args']], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
def request(item):
    proc.stdin.write(json.dumps(item) + '\n'); proc.stdin.flush()
    return json.loads(proc.stdout.readline())

answer = request({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': 'blocks_read', 'arguments': {'pageId': 'fixture-page'}}})
denied = request({'jsonrpc': '2.0', 'id': 2, 'method': 'tools/call', 'params': {'name': 'blocks_read', 'arguments': {'pageId': 'other-page'}}})
proc.stdin.close(); proc.wait(timeout=10)
if proc.returncode != 0 or answer['result'].get('isError') or not denied['result'].get('isError'):
    sys.exit(5)
print(json.dumps({'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'name': 'mcp__worlds__blocks_read', 'input': {'pageId': 'fixture-page'}}, {'type': 'text', 'text': 'Fixture read completed'}]}}), flush=True)
print(json.dumps({'type': 'user', 'message': {'content': [{'type': 'tool_result', 'is_error': False}]}}), flush=True)
print(json.dumps({'type': 'result', 'result': 'Fixture read completed', 'is_error': False}), flush=True)

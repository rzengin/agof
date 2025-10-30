curl -s http://127.0.0.1:8000/openai/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"How does Kong AI Gateway work?"}]}'


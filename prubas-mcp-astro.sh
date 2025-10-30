# initialize
curl -s -X POST http://localhost:3211/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"curl","version":"0.0.1"},"protocolVersion":"2024-06-01"}}' | jq

# tools/list
curl -s -X POST http://localhost:3211/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | jq

# consentimiento: status
curl -s -X POST http://localhost:3211/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"cmf.consent.status","arguments":{"customerId":"cust-001","resource":"transactions","scope":"TRANSACTIONS_READ"}}}' | jq

# si no está activo, otórgalo
curl -s -X POST http://localhost:3211/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"cmf.consent.grant","arguments":{"customerId":"cust-001","resource":"transactions","scope":"TRANSACTIONS_READ","durationDays":30}}}' | jq

# listar cuentas
curl -s -X POST http://localhost:3211/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"cmf.accounts.list","arguments":{"customerId":"cust-001"}}}' | jq

# buscar movimientos
curl -s -X POST http://localhost:3211/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"cmf.tx.search","arguments":{"accountId":"acc-001","from":"2025-10-01","to":"2025-10-31"}}}' | jq

# capacidad de pago
curl -s -X POST http://localhost:3211/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"cmf.cashflow.compute","arguments":{"customerId":"cust-001","horizonDays":30}}}' | jq

# suscripción a eventos
curl -s -X POST http://localhost:3211/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"cmf.events.subscribe","arguments":{"topic":"transactions.created","callbackUrl":"http://localhost:9999/callback"}}}' | jq

# emitir evento mock
curl -s -X POST http://localhost:3211/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"cmf.events.emit","arguments":{"topic":"transactions.created","payload":{"accountId":"acc-001","date":"'"$(date +%F)"'","amount":-45000,"description":"Café y snacks"}}}}' | jq

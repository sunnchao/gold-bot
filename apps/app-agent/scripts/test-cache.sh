#!/usr/bin/env bash
# Test script to verify prompt caching effectiveness

set -e

API_URL="${API_URL:-http://localhost:3100}"
ACCOUNT_ID="${ACCOUNT_ID:-account1}"
SYMBOL="${SYMBOL:-XAUUSD}"

echo "============================================"
echo "Prompt Caching Performance Test"
echo "============================================"
echo "API: $API_URL"
echo "Symbol: $SYMBOL"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test function
test_request() {
  local label=$1
  local delay=$2

  echo -e "${YELLOW}▶ $label${NC}"

  if [ "$delay" -gt 0 ]; then
    echo "  Waiting ${delay}s..."
    sleep "$delay"
  fi

  local start=$(date +%s%3N)

  local response=$(curl -s -X POST "$API_URL/trigger/analyze" \
    -H "Content-Type: application/json" \
    -d "{\"accountId\":\"$ACCOUNT_ID\",\"symbol\":\"$SYMBOL\"}" \
    2>&1)

  local end=$(date +%s%3N)
  local elapsed=$((end - start))

  echo "  Elapsed: ${elapsed}ms"

  # Try to extract cache stats from logs (Anthropic only)
  sleep 1
  local cache_stats=$(docker logs gold-analysis-nj 2>&1 | \
    grep "Prompt cache stats" | \
    tail -1 | \
    grep -o '"cacheRead":[0-9]*,"cacheCreation":[0-9]*,"hitRate":"[0-9.]*%"' || echo "")

  if [ -n "$cache_stats" ]; then
    local cache_read=$(echo "$cache_stats" | grep -o '"cacheRead":[0-9]*' | cut -d: -f2)
    local cache_creation=$(echo "$cache_stats" | grep -o '"cacheCreation":[0-9]*' | cut -d: -f2)
    local hit_rate=$(echo "$cache_stats" | grep -o '"hitRate":"[0-9.]*%"' | cut -d: -f2 | tr -d '"')

    echo -e "  ${GREEN}Cache Read: $cache_read tokens${NC}"
    echo -e "  Cache Creation: $cache_creation tokens"
    echo -e "  ${GREEN}Hit Rate: $hit_rate${NC}"
  else
    echo -e "  ${YELLOW}(Cache stats not available - check logs manually)${NC}"
  fi

  echo ""
}

# Test 1: Cold start
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 1: Cold Start (First Request)"
echo "Expected: cacheCreation > 0, cacheRead = 0"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_request "First request (cache miss expected)" 0

# Test 2: Immediate follow-up
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 2: Warm Cache (10s later)"
echo "Expected: cacheRead > 0, cacheCreation = 0, hitRate ~100%"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_request "Second request (cache hit expected)" 10

# Test 3: Another immediate request
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 3: Warm Cache (20s later)"
echo "Expected: cacheRead > 0, hitRate ~100%"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_request "Third request (cache hit expected)" 10

echo "============================================"
echo "Test Complete"
echo "============================================"
echo ""
echo "💡 Tips:"
echo "  - For Anthropic: Check logs for detailed cache stats"
echo "  - For OpenAI: Cache is automatic (50% discount on prefix)"
echo "  - Cache TTL is 5 minutes"
echo "  - Run 'docker logs gold-analysis-nj | grep cache' to see all cache events"
echo ""
echo "📊 To calculate cost savings:"
echo "  - No cache: 6000 tokens × \$3/M = \$0.018 per request"
echo "  - With cache (80% hit): ~\$0.004 per request"
echo "  - Savings: 78% cost reduction"
echo ""

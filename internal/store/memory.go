package store

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"gold-bot/internal/domain"
)

// StateStore holds in-memory state for a single (account_id, symbol) pair.
type StateStore struct {
	mu        sync.RWMutex
	bars      map[string][]domain.Bar // timeframe -> bars
	tick      domain.TickSnapshot
	positions []domain.Position
	mapping   map[string]string
	aiResult  json.RawMessage
}

func newStateStore() *StateStore {
	return &StateStore{
		bars:      make(map[string][]domain.Bar),
		mapping:   make(map[string]string),
		aiResult:  json.RawMessage(`{}`),
		positions: []domain.Position{},
	}
}

// memoryAccountStore implements an in-memory store with 2D indexing: accountID -> symbol -> StateStore.
type memoryAccountStore struct {
	mu       sync.RWMutex
	states   map[string]map[string]*StateStore // accountID -> symbol -> *StateStore
	tokens   map[string]bool                   // token -> valid
	accounts map[string]domain.Account         // accountID -> Account
	runtimes map[string]domain.AccountRuntime  // accountID -> Runtime
}

// NewMemoryAccountStore creates a new in-memory account store.
func NewMemoryAccountStore() *memoryAccountStore {
	return &memoryAccountStore{
		states:   make(map[string]map[string]*StateStore),
		tokens:   make(map[string]bool),
		accounts: make(map[string]domain.Account),
		runtimes: make(map[string]domain.AccountRuntime),
	}
}

func (m *memoryAccountStore) getOrCreateState(accountID, symbol string) *StateStore {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.states[accountID] == nil {
		m.states[accountID] = make(map[string]*StateStore)
	}
	if m.states[accountID][symbol] == nil {
		m.states[accountID][symbol] = newStateStore()
	}
	return m.states[accountID][symbol]
}

func (m *memoryAccountStore) getState(accountID, symbol string) (*StateStore, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.states[accountID] == nil {
		return nil, false
	}
	state, ok := m.states[accountID][symbol]
	return state, ok
}

// SaveTickSnapshot saves a tick snapshot for the given account and symbol.
func (m *memoryAccountStore) SaveTickSnapshot(ctx context.Context, accountID, symbol string, tick domain.TickSnapshot, updatedAt time.Time) error {
	state := m.getOrCreateState(accountID, symbol)
	state.mu.Lock()
	defer state.mu.Unlock()
	state.tick = tick
	return nil
}

// GetTickSnapshot retrieves the tick snapshot for the given account and symbol.
func (m *memoryAccountStore) GetTickSnapshot(ctx context.Context, accountID, symbol string) (domain.TickSnapshot, error) {
	state, ok := m.getState(accountID, symbol)
	if !ok {
		return domain.TickSnapshot{}, nil
	}
	state.mu.RLock()
	defer state.mu.RUnlock()
	return state.tick, nil
}

// SaveBars saves bars for the given account, symbol, and timeframe.
func (m *memoryAccountStore) SaveBars(ctx context.Context, accountID, symbol, timeframe string, bars []domain.Bar, updatedAt time.Time) error {
	state := m.getOrCreateState(accountID, symbol)
	state.mu.Lock()
	defer state.mu.Unlock()
	state.bars[timeframe] = bars
	return nil
}

// GetBarCache retrieves bars for the given account and symbol.
func (m *memoryAccountStore) GetBarCache(ctx context.Context, accountID, symbol string) (map[string][]domain.Bar, error) {
	state, ok := m.getState(accountID, symbol)
	if !ok {
		return make(map[string][]domain.Bar), nil
	}
	state.mu.RLock()
	defer state.mu.RUnlock()

	// Return a copy
	result := make(map[string][]domain.Bar, len(state.bars))
	for tf, bars := range state.bars {
		result[tf] = bars
	}
	return result, nil
}

// SavePositions saves positions for the given account and symbol.
func (m *memoryAccountStore) SavePositions(ctx context.Context, accountID, symbol string, positions []domain.Position, updatedAt time.Time) error {
	state := m.getOrCreateState(accountID, symbol)
	state.mu.Lock()
	defer state.mu.Unlock()
	state.positions = positions
	return nil
}

// GetPositions retrieves positions for the given account and symbol.
func (m *memoryAccountStore) GetPositions(ctx context.Context, accountID, symbol string) ([]domain.Position, error) {
	state, ok := m.getState(accountID, symbol)
	if !ok {
		return []domain.Position{}, nil
	}
	state.mu.RLock()
	defer state.mu.RUnlock()
	return state.positions, nil
}

// SaveStrategyMapping saves strategy mapping for the given account and symbol.
func (m *memoryAccountStore) SaveStrategyMapping(ctx context.Context, accountID, symbol string, mapping map[string]string, updatedAt time.Time) error {
	state := m.getOrCreateState(accountID, symbol)
	state.mu.Lock()
	defer state.mu.Unlock()
	state.mapping = mapping
	return nil
}

// GetStrategyMapping retrieves strategy mapping for the given account and symbol.
func (m *memoryAccountStore) GetStrategyMapping(ctx context.Context, accountID, symbol string) (map[string]string, error) {
	state, ok := m.getState(accountID, symbol)
	if !ok {
		return make(map[string]string), nil
	}
	state.mu.RLock()
	defer state.mu.RUnlock()
	return state.mapping, nil
}

// SaveAIResult saves AI result for the given account and symbol.
func (m *memoryAccountStore) SaveAIResult(ctx context.Context, accountID, symbol string, payload json.RawMessage, updatedAt time.Time) error {
	state := m.getOrCreateState(accountID, symbol)
	state.mu.Lock()
	defer state.mu.Unlock()
	state.aiResult = payload
	return nil
}

// GetState returns the account state for the default symbol (XAUUSD) for backward compatibility.
func (m *memoryAccountStore) GetState(ctx context.Context, accountID string) (domain.AccountState, error) {
	return m.GetStateSymbol(ctx, accountID, "XAUUSD")
}

// GetStateSymbol returns the account state for a specific (account_id, symbol) pair.
func (m *memoryAccountStore) GetStateSymbol(ctx context.Context, accountID, symbol string) (domain.AccountState, error) {
	state, ok := m.getState(accountID, symbol)
	if !ok {
		return domain.AccountState{
			AccountID:       accountID,
			Symbol:          symbol,
			Bars:            map[string][]domain.Bar{},
			Positions:       []domain.Position{},
			StrategyMapping: map[string]string{},
			AIResultJSON:    json.RawMessage(`{}`),
		}, nil
	}

	state.mu.RLock()
	defer state.mu.RUnlock()

	return domain.AccountState{
		AccountID:       accountID,
		Symbol:          symbol,
		Tick:            state.tick,
		Bars:            state.bars,
		Positions:       state.positions,
		StrategyMapping: state.mapping,
		AIResultJSON:    state.aiResult,
	}, nil
}

// ListSymbols returns all symbols stored for a given account_id.
func (m *memoryAccountStore) ListSymbols(ctx context.Context, accountID string) ([]string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.states[accountID] == nil {
		return []string{}, nil
	}

	symbols := make([]string, 0, len(m.states[accountID]))
	for symbol := range m.states[accountID] {
		symbols = append(symbols, symbol)
	}
	return symbols, nil
}

// ListAccounts returns all accounts.
func (m *memoryAccountStore) ListAccounts(ctx context.Context) ([]domain.Account, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	accounts := make([]domain.Account, 0, len(m.accounts))
	for _, acc := range m.accounts {
		accounts = append(accounts, acc)
	}
	return accounts, nil
}

// GetAccount returns an account by ID.
func (m *memoryAccountStore) GetAccount(ctx context.Context, accountID string) (domain.Account, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	acc, ok := m.accounts[accountID]
	if !ok {
		return domain.Account{}, fmt.Errorf("account not found: %s", accountID)
	}
	return acc, nil
}

// GetRuntime returns the runtime state for an account.
func (m *memoryAccountStore) GetRuntime(ctx context.Context, accountID string) (domain.AccountRuntime, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	runtime, ok := m.runtimes[accountID]
	if !ok {
		return domain.AccountRuntime{}, fmt.Errorf("runtime not found: %s", accountID)
	}
	return runtime, nil
}

// UpsertAccount creates or updates an account.
func (m *memoryAccountStore) UpsertAccount(ctx context.Context, account domain.Account) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.accounts[account.AccountID] = account
	return nil
}

// EnsureAccount ensures an account exists.
func (m *memoryAccountStore) EnsureAccount(ctx context.Context, accountID string, updatedAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.accounts[accountID]; !ok {
		m.accounts[accountID] = domain.Account{
			AccountID: accountID,
		}
	}
	return nil
}

// SaveHeartbeat saves heartbeat data.
func (m *memoryAccountStore) SaveHeartbeat(ctx context.Context, runtime domain.AccountRuntime) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runtimes[runtime.AccountID] = runtime
	return nil
}

// SaveTick updates the tick time for an account.
func (m *memoryAccountStore) SaveTick(ctx context.Context, accountID string, updatedAt time.Time) error {
	// No-op for memory store, tick data is saved via SaveTickSnapshot
	return nil
}

// TouchRuntime updates the runtime timestamp.
func (m *memoryAccountStore) TouchRuntime(ctx context.Context, accountID string, updatedAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if runtime, ok := m.runtimes[accountID]; ok {
		m.runtimes[accountID] = runtime
	}
	return nil
}

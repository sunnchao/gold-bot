package legacy

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

var errMissingAccountID = errors.New("missing account_id")

func decodeJSONBody(r *http.Request, dst any) error {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		return err
	}

	return nil
}

func requireAccountID(accountID string) (string, error) {
	accountID = strings.TrimSpace(accountID)
	if accountID == "" {
		return "", errMissingAccountID
	}

	return accountID, nil
}

func writeBadRequest(w http.ResponseWriter, message string) {
	writeJSON(w, http.StatusBadRequest, map[string]any{
		"status":  "ERROR",
		"message": message,
	})
}

func authorizeAccountWrite(r *http.Request, tokens TokenStore, accountID string) (bool, error) {
	return tokens.AuthorizeAccount(r.Context(), tokenFromContext(r.Context()), accountID)
}

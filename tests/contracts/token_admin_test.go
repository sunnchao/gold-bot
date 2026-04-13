package contracts

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminTokenLifecycle(t *testing.T) {
	ts, _ := newAdminServer(t)

	createRec := httptest.NewRecorder()
	createReq := httptest.NewRequest(http.MethodPost, "/api/tokens", strings.NewReader(`{
		"name":"Desk",
		"accounts":["90011087","90022000"]
	}`))
	createReq.Header.Set("Content-Type", "application/json")
	createReq.Header.Set("X-API-Token", "admin-token")
	ts.ServeHTTP(createRec, createReq)

	if createRec.Code != http.StatusOK {
		t.Fatalf("POST /api/tokens status = %d, want %d", createRec.Code, http.StatusOK)
	}

	var created struct {
		Status   string   `json:"status"`
		Token    string   `json:"token"`
		Name     string   `json:"name"`
		Accounts []string `json:"accounts"`
	}
	if err := json.Unmarshal(createRec.Body.Bytes(), &created); err != nil {
		t.Fatalf("Unmarshal create token returned error: %v", err)
	}
	if created.Status != "OK" {
		t.Fatalf("status = %q, want OK", created.Status)
	}
	if created.Token == "" {
		t.Fatal("token = empty, want generated token")
	}

	listRec := httptest.NewRecorder()
	listReq := httptest.NewRequest(http.MethodGet, "/api/tokens", nil)
	listReq.Header.Set("X-API-Token", "admin-token")
	ts.ServeHTTP(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("GET /api/tokens status = %d, want %d", listRec.Code, http.StatusOK)
	}

	var listed struct {
		Status string                 `json:"status"`
		Tokens map[string]tokenRecord `json:"tokens"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("Unmarshal list tokens returned error: %v", err)
	}
	if listed.Status != "OK" {
		t.Fatalf("status = %q, want OK", listed.Status)
	}

	var masked string
	for key, token := range listed.Tokens {
		if token.FullToken == created.Token {
			masked = key
			break
		}
	}
	if masked == "" {
		t.Fatalf("created token %q not found in list", created.Token)
	}

	deleteRec := httptest.NewRecorder()
	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/tokens/"+created.Token[:8], nil)
	deleteReq.Header.Set("X-API-Token", "admin-token")
	ts.ServeHTTP(deleteRec, deleteReq)

	if deleteRec.Code != http.StatusOK {
		t.Fatalf("DELETE /api/tokens status = %d, want %d", deleteRec.Code, http.StatusOK)
	}
}

func TestEAEndpointsExposeVersionAndDownload(t *testing.T) {
	ts, _ := newAdminServer(t)

	versionRec := httptest.NewRecorder()
	versionReq := httptest.NewRequest(http.MethodGet, "/api/ea/version", nil)
	ts.ServeHTTP(versionRec, versionReq)

	if versionRec.Code != http.StatusOK {
		t.Fatalf("GET /api/ea/version status = %d, want %d", versionRec.Code, http.StatusOK)
	}

	var version struct {
		Status    string `json:"status"`
		Version   string `json:"version"`
		Build     int    `json:"build"`
		Changelog string `json:"changelog"`
	}
	if err := json.Unmarshal(versionRec.Body.Bytes(), &version); err != nil {
		t.Fatalf("Unmarshal version returned error: %v", err)
	}
	if version.Status != "OK" {
		t.Fatalf("status = %q, want OK", version.Status)
	}
	if version.Version == "" || version.Build == 0 {
		t.Fatalf("version/build = (%q, %d), want non-empty", version.Version, version.Build)
	}

	downloadRec := httptest.NewRecorder()
	downloadReq := httptest.NewRequest(http.MethodGet, "/api/ea/download", nil)
	downloadReq.Header.Set("X-API-Token", "user-token")
	ts.ServeHTTP(downloadRec, downloadReq)

	if downloadRec.Code != http.StatusOK {
		t.Fatalf("GET /api/ea/download status = %d, want %d", downloadRec.Code, http.StatusOK)
	}

	body, err := io.ReadAll(downloadRec.Body)
	if err != nil {
		t.Fatalf("ReadAll download body returned error: %v", err)
	}
	if !strings.Contains(string(body), "GoldBolt_Client") {
		t.Fatalf("download body missing EA content marker")
	}
}

type tokenRecord struct {
	Name      string   `json:"name"`
	Accounts  []string `json:"accounts"`
	FullToken string   `json:"full_token"`
}

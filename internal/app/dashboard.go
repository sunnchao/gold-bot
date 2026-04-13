package app

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func newDashboardHandler(distDir string) http.Handler {
	if distDir == "" {
		return http.NotFoundHandler()
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		target, ok := resolveDashboardFile(distDir, r.URL.Path)
		if !ok {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, target)
	})
}

func findDashboardDist() string {
	candidates := []string{
		filepath.Join("web", "dashboard", "dist"),
		filepath.Join("..", "..", "web", "dashboard", "dist"),
	}

	if exe, err := os.Executable(); err == nil {
		base := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(base, "web", "dashboard", "dist"),
			filepath.Join(base, "..", "..", "web", "dashboard", "dist"),
		)
	}

	for _, candidate := range candidates {
		if stat, err := os.Stat(candidate); err == nil && stat.IsDir() {
			return candidate
		}
	}
	return ""
}

func resolveDashboardFile(distDir, requestPath string) (string, bool) {
	cleaned := strings.TrimPrefix(path.Clean("/"+requestPath), "/")
	if cleaned == "." {
		cleaned = ""
	}

	candidates := make([]string, 0, 6)
	if cleaned == "" {
		candidates = append(candidates, filepath.Join(distDir, "index.html"))
	} else {
		candidates = append(candidates,
			filepath.Join(distDir, cleaned),
			filepath.Join(distDir, cleaned, "index.html"),
			filepath.Join(distDir, cleaned+".html"),
		)
	}

	if strings.HasPrefix(cleaned, "accounts/") {
		candidates = append(candidates,
			filepath.Join(distDir, "accounts", "__dynamic__", "index.html"),
			filepath.Join(distDir, "accounts", "__dynamic__.html"),
		)
	}
	if !strings.Contains(filepath.Base(cleaned), ".") {
		candidates = append(candidates, filepath.Join(distDir, "index.html"))
	}

	for _, candidate := range candidates {
		if stat, err := os.Stat(candidate); err == nil && !stat.IsDir() {
			return candidate, true
		}
	}
	return "", false
}

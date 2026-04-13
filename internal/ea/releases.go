package ea

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type ReleaseInfo struct {
	Version   string `json:"version"`
	Build     int    `json:"build"`
	Changelog string `json:"changelog"`
	FilePath  string `json:"-"`
}

type ReleaseSource interface {
	Current() (ReleaseInfo, error)
}

type LocalReleaseSource struct {
	root string
}

func NewLocalReleaseSource(root string) *LocalReleaseSource {
	return &LocalReleaseSource{root: root}
}

func (s *LocalReleaseSource) Current() (ReleaseInfo, error) {
	versionPath := s.findPath("mt4_ea", "version.json")
	filePath := s.findPath("mt4_ea", "GoldBolt_Client.mq4")
	info := ReleaseInfo{
		Version:   "0.0.0",
		Build:     0,
		Changelog: "",
		FilePath:  filePath,
	}

	data, err := os.ReadFile(versionPath)
	if err != nil {
		if os.IsNotExist(err) {
			return info, nil
		}
		return ReleaseInfo{}, fmt.Errorf("read EA version file: %w", err)
	}

	if err := json.Unmarshal(data, &info); err != nil {
		return ReleaseInfo{}, fmt.Errorf("decode EA version file: %w", err)
	}
	info.FilePath = filePath
	return info, nil
}

func (s *LocalReleaseSource) findPath(parts ...string) string {
	candidates := []string{
		filepath.Join(append([]string{s.root}, parts...)...),
		filepath.Join(append([]string{s.root, ".."}, parts...)...),
		filepath.Join(append([]string{s.root, "..", ".."}, parts...)...),
	}
	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return filepath.Join(append([]string{s.root}, parts...)...)
}

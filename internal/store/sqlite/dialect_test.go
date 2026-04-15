package sqlite

import "testing"

func TestDetectDialectRecognizesPostgresURLForms(t *testing.T) {
	tests := []struct {
		name string
		dsn  string
		want bool
	}{
		{name: "postgres url", dsn: "postgres://user:pass@localhost:5432/goldbot", want: true},
		{name: "postgresql url", dsn: "postgresql://user:pass@localhost:5432/goldbot", want: true},
		{name: "empty dsn", dsn: "", want: false},
		{name: "key value dsn", dsn: "host=localhost port=5432 user=goldbot password=secret dbname=goldbot sslmode=disable", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := detectPg(tt.dsn); got != tt.want {
				t.Fatalf("detectPg(%q) = %v, want %v", tt.dsn, got, tt.want)
			}
		})
	}
}

func TestPhsFromUsesCorrectPostgresSequence(t *testing.T) {
	t.Cleanup(resetDialectForTest)
	setPgForTest(true)

	if got := phsFrom(3, 4); got != "$3, $4, $5, $6" {
		t.Fatalf("phsFrom(3, 4) = %q, want %q", got, "$3, $4, $5, $6")
	}
}

func TestPhsFromUsesQuestionMarksForSQLite(t *testing.T) {
	t.Cleanup(resetDialectForTest)
	setPgForTest(false)

	if got := phsFrom(3, 4); got != "?, ?, ?, ?" {
		t.Fatalf("phsFrom(3, 4) = %q, want %q", got, "?, ?, ?, ?")
	}
}

func TestDeleteStalePositionStatesPlaceholderSequenceStartsAtThreeForPostgres(t *testing.T) {
	t.Cleanup(resetDialectForTest)
	setPgForTest(true)

	if got := phsFrom(3, 2); got != "$3, $4" {
		t.Fatalf("phsFrom(3, 2) = %q, want %q", got, "$3, $4")
	}
}

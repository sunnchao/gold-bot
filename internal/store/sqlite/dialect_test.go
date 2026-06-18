package sqlite

import "testing"

func TestDialectAlwaysReturnsPostgres(t *testing.T) {
	if got := Dialect(); got != "postgres" {
		t.Fatalf("Dialect() = %q, want %q", got, "postgres")
	}
}

func TestPhsFromUsesCorrectPostgresSequence(t *testing.T) {
	if got := phsFrom(3, 4); got != "$3, $4, $5, $6" {
		t.Fatalf("phsFrom(3, 4) = %q, want %q", got, "$3, $4, $5, $6")
	}
}

func TestPhAlwaysUsesPostgresPlaceholders(t *testing.T) {
	if got := ph(2); got != "$2" {
		t.Fatalf("ph(2) = %q, want %q", got, "$2")
	}
}

func TestDeleteStalePositionStatesPlaceholderSequenceStartsAtThreeForPostgres(t *testing.T) {
	if got := phsFrom(3, 2); got != "$3, $4" {
		t.Fatalf("phsFrom(3, 2) = %q, want %q", got, "$3, $4")
	}
}

func TestPgTextIsEmptyForPostgres(t *testing.T) {
	if got := pgText(); got != "" {
		t.Fatalf("pgText() = %q, want empty string", got)
	}
}

func TestJSONExtractUsesPostgresJSONBTextExtraction(t *testing.T) {
	if got := jsonExtract("payload_json", "source"); got != "payload_json::jsonb->>'source'" {
		t.Fatalf("jsonExtract(payload_json, source) = %q, want %q", got, "payload_json::jsonb->>'source'")
	}
}

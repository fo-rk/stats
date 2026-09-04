CREATE TABLE IF NOT EXISTS journey_events (
  id TEXT PRIMARY KEY,
  website TEXT NOT NULL,
  journey TEXT NOT NULL,
  step TEXT NOT NULL,
  kind TEXT NOT NULL,
  visitor_hash TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journey_site_time ON journey_events (website, journey, timestamp);
CREATE INDEX IF NOT EXISTS idx_journey_site_visitor ON journey_events (website, journey, visitor_hash);

CREATE TABLE IF NOT EXISTS pageviews (
  id TEXT PRIMARY KEY,
  website TEXT NOT NULL,
  path TEXT NOT NULL,
  referrer TEXT,
  country TEXT,
  visitor_hash TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pageviews_site_time ON pageviews (website, timestamp);
CREATE INDEX IF NOT EXISTS idx_pageviews_site_visitor ON pageviews (website, visitor_hash, timestamp);
CREATE INDEX IF NOT EXISTS idx_pageviews_site_path ON pageviews (website, path, timestamp);

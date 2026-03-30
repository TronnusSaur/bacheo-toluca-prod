-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Table for Territorial Zones (Delegaciones/Colonias)
CREATE TABLE IF NOT EXISTS zones (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT, -- 'DELEGACION' or 'COLONIA'
    geom GEOMETRY(MultiPolygon, 4326)
);

-- Table for Baches (Reports)
CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    contract_id TEXT,
    folio TEXT UNIQUE,
    citizen_link TEXT,
    location_desc TEXT,
    address TEXT,
    delegacion_id INTEGER REFERENCES zones(id),
    status TEXT DEFAUlT 'PENDIENTE', -- 'PENDIENTE', 'PROCESO', 'TERMINADO'
    largo FLOAT,
    ancho FLOAT,
    profundidad FLOAT,
    m2 FLOAT,
    geom GEOMETRY(Point, 4326),
    photo_init_url TEXT,
    photo_end_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for spatial queries
CREATE INDEX IF NOT EXISTS zones_geom_idx ON zones USING GIST (geom);
CREATE INDEX IF NOT EXISTS reports_geom_idx ON reports USING GIST (geom);

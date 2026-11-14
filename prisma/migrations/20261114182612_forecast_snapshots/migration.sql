-- CreateEnum
CREATE TYPE "weather_source" AS ENUM ('ATMOSPHERIC', 'MARINE');

-- CreateTable
CREATE TABLE "forecast_snapshots" (
    "location_id" TEXT NOT NULL,
    "source" "weather_source" NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "coverage_start" TIMESTAMPTZ(3) NOT NULL,
    "coverage_end" TIMESTAMPTZ(3) NOT NULL,
    "requested_latitude" DOUBLE PRECISION NOT NULL,
    "requested_longitude" DOUBLE PRECISION NOT NULL,
    "returned_latitude" DOUBLE PRECISION NOT NULL,
    "returned_longitude" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT NOT NULL,
    "units" JSONB NOT NULL,
    "hourly" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "forecast_snapshots_pkey" PRIMARY KEY ("location_id","source","schema_version")
);

-- AddForeignKey
ALTER TABLE "forecast_snapshots" ADD CONSTRAINT "forecast_snapshots_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

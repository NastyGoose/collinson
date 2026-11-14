-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_searches" (
    "query" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "location_searches_pkey" PRIMARY KEY ("query","country_code")
);

-- CreateTable
CREATE TABLE "location_search_results" (
    "query" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "location_id" TEXT NOT NULL,

    CONSTRAINT "location_search_results_pkey" PRIMARY KEY ("query","country_code","position")
);

-- CreateIndex
CREATE INDEX "location_search_results_location_id_idx" ON "location_search_results"("location_id");

-- AddForeignKey
ALTER TABLE "location_search_results" ADD CONSTRAINT "location_search_results_query_country_code_fkey" FOREIGN KEY ("query", "country_code") REFERENCES "location_searches"("query", "country_code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_search_results" ADD CONSTRAINT "location_search_results_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

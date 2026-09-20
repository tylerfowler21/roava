-- CreateTable
CREATE TABLE "TripWant" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripWant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripWant_tripId_createdAt_idx" ON "TripWant"("tripId", "createdAt");

-- AddForeignKey
ALTER TABLE "TripWant" ADD CONSTRAINT "TripWant_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripWant" ADD CONSTRAINT "TripWant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

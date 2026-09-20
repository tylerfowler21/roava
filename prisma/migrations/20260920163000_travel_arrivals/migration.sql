-- CreateTable
CREATE TABLE "TravelArrival" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelArrival_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TravelArrival_userId_idx" ON "TravelArrival"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TravelArrival_itemId_userId_key" ON "TravelArrival"("itemId", "userId");

-- AddForeignKey
ALTER TABLE "TravelArrival" ADD CONSTRAINT "TravelArrival_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ItineraryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelArrival" ADD CONSTRAINT "TravelArrival_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

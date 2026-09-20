-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "headcount" INTEGER;

-- AlterTable
ALTER TABLE "ItineraryItem" ADD COLUMN     "costEach" BOOLEAN NOT NULL DEFAULT false;

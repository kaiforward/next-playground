-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" DATETIME,
    "passwordHash" TEXT NOT NULL,
    "image" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" DATETIME NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "credits" REAL NOT NULL DEFAULT 1000,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "systemId" TEXT NOT NULL,
    CONSTRAINT "Player_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Player_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "StarSystem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ship" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Starter Ship',
    "fuel" REAL NOT NULL DEFAULT 100,
    "maxFuel" REAL NOT NULL DEFAULT 100,
    "cargoMax" INTEGER NOT NULL DEFAULT 50,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Ship_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CargoItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipId" TEXT NOT NULL,
    "goodId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "CargoItem_shipId_fkey" FOREIGN KEY ("shipId") REFERENCES "Ship" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CargoItem_goodId_fkey" FOREIGN KEY ("goodId") REFERENCES "Good" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StarSystem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "economyType" TEXT NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "description" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "SystemConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fromSystemId" TEXT NOT NULL,
    "toSystemId" TEXT NOT NULL,
    "fuelCost" REAL NOT NULL DEFAULT 10,
    CONSTRAINT "SystemConnection_fromSystemId_fkey" FOREIGN KEY ("fromSystemId") REFERENCES "StarSystem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SystemConnection_toSystemId_fkey" FOREIGN KEY ("toSystemId") REFERENCES "StarSystem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "systemId" TEXT NOT NULL,
    CONSTRAINT "Station_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "StarSystem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Good" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "basePrice" REAL NOT NULL,
    "category" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "StationMarket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "goodId" TEXT NOT NULL,
    "supply" REAL NOT NULL,
    "demand" REAL NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StationMarket_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StationMarket_goodId_fkey" FOREIGN KEY ("goodId") REFERENCES "Good" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TradeHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stationId" TEXT NOT NULL,
    "goodId" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "quantity" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "playerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TradeHistory_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradeHistory_goodId_fkey" FOREIGN KEY ("goodId") REFERENCES "Good" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "Player_userId_key" ON "Player"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Ship_playerId_key" ON "Ship"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "CargoItem_shipId_goodId_key" ON "CargoItem"("shipId", "goodId");

-- CreateIndex
CREATE UNIQUE INDEX "StarSystem_name_key" ON "StarSystem"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConnection_fromSystemId_toSystemId_key" ON "SystemConnection"("fromSystemId", "toSystemId");

-- CreateIndex
CREATE UNIQUE INDEX "Station_systemId_key" ON "Station"("systemId");

-- CreateIndex
CREATE UNIQUE INDEX "Good_name_key" ON "Good"("name");

-- CreateIndex
CREATE UNIQUE INDEX "StationMarket_stationId_goodId_key" ON "StationMarket"("stationId", "goodId");

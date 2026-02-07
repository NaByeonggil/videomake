-- CreateTable
CREATE TABLE `projects` (
    `id` CHAR(36) NOT NULL,
    `projectName` VARCHAR(100) NOT NULL,
    `displayName` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `resolution` VARCHAR(20) NOT NULL DEFAULT '512x512',
    `frameRate` INTEGER NOT NULL DEFAULT 8,
    `projectStatus` VARCHAR(50) NOT NULL DEFAULT 'draft',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clips` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `clipName` VARCHAR(255) NOT NULL,
    `orderIndex` INTEGER NOT NULL DEFAULT 0,
    `prompt` TEXT NULL,
    `negativePrompt` TEXT NULL,
    `seedValue` BIGINT NULL,
    `stepsCount` INTEGER NOT NULL DEFAULT 20,
    `cfgScale` DOUBLE NOT NULL DEFAULT 7.5,
    `referenceImage` VARCHAR(500) NULL,
    `ipAdapterWeight` DOUBLE NULL DEFAULT 0.8,
    `filePath` VARCHAR(500) NULL,
    `fileName` VARCHAR(255) NULL,
    `thumbnailPath` VARCHAR(500) NULL,
    `thumbnailName` VARCHAR(255) NULL,
    `durationSec` DOUBLE NULL,
    `frameCount` INTEGER NULL,
    `clipStatus` VARCHAR(50) NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `clips_projectId_idx`(`projectId`),
    INDEX `clips_orderIndex_idx`(`orderIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobs` (
    `id` CHAR(36) NOT NULL,
    `projectId` CHAR(36) NOT NULL,
    `jobType` VARCHAR(50) NOT NULL,
    `inputClipIds` JSON NULL,
    `jobSettings` JSON NULL,
    `outputPath` VARCHAR(500) NULL,
    `outputFileName` VARCHAR(255) NULL,
    `progressPercent` TINYINT NOT NULL DEFAULT 0,
    `jobStatus` VARCHAR(50) NOT NULL DEFAULT 'pending',
    `errorMessage` TEXT NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `jobs_projectId_idx`(`projectId`),
    INDEX `jobs_jobStatus_idx`(`jobStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `jobLogs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `jobId` CHAR(36) NOT NULL,
    `logLevel` VARCHAR(20) NOT NULL,
    `logMessage` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `jobLogs_jobId_idx`(`jobId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `clips` ADD CONSTRAINT `clips_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `jobLogs` ADD CONSTRAINT `jobLogs_jobId_fkey` FOREIGN KEY (`jobId`) REFERENCES `jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

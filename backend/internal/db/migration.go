package db

import (
	"auto-issue/internal/models"

	"gorm.io/gorm"
)

func RunMigration(db *gorm.DB) {
	CreateTables(db)
}

func CreateTables(db *gorm.DB) {
	db.AutoMigrate(&models.Issue{})
	db.AutoMigrate(&models.Config{})
}

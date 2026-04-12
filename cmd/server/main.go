package main

import (
	"log"

	"gold-bot/internal/app"
)

func main() {
	cfg := app.MustLoadConfig()
	server, err := app.New(cfg)
	if err != nil {
		log.Fatal(err)
	}

	log.Fatal(server.Run())
}

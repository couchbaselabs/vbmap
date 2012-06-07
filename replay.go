package main

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"log"
	"os"
	"time"

	"github.com/couchbaselabs/go-couchbase"
	"github.com/dustin/replaykit"
)

type replayEvent struct {
	All       map[string]map[string]interface{}
	Bucket    couchbase.Bucket `json:"bucket-data"`
	Timings   map[string]map[string]interface{}
	VBDetails map[string]map[string]interface{} `json:"vbucket-details"`
	Timestamp time.Time                         `json:"ts"`
}

type playbackState struct {
	statech chan *replayEvent
	reqch   chan chan *replayEvent

	st *replayEvent
}

func (c *playbackState) loop() {
	for {
		select {
		case c.st = <-c.statech:
		case req := <-c.reqch:
			req <- c.st
		}
	}
}

func (c *playbackState) current() *replayEvent {
	ch := make(chan *replayEvent)
	c.reqch <- ch
	return <-ch
}

var currentState playbackState

func (r *replayEvent) TS() time.Time {
	return r.Timestamp
}

type replaySource struct {
	d *json.Decoder
}

func (r *replaySource) Next() replay.Event {
	rv := replayEvent{}
	err := r.d.Decode(&rv)
	if err != nil {
		if err != io.EOF {
			log.Printf("Error decoding: %v", err)
		}
		return nil
	}
	return &rv
}

type replayAction struct {
}

func (r *replayAction) Process(ev replay.Event) {
	re := ev.(*replayEvent)
	log.Printf("Got thing as of %v", re.TS())
	currentState.statech <- re
}

func replayFile(replaySpeed float64, path string) {
	r := replay.New(replaySpeed)
	f, err := os.Open(path)
	maybefatal(err, "Error opening replay data: %v", err)
	defer f.Close()
	g, err := gzip.NewReader(f)
	maybefatal(err, "Error starting decompression stream: %v", err)

	rs := &replaySource{json.NewDecoder(g)}
	a := &replayAction{}

	r.Run(rs, a)

}

func startReplay(replaySpeed float64, path string) {
	currentState.statech = make(chan *replayEvent)
	currentState.reqch = make(chan chan *replayEvent)

	go currentState.loop()

	for {
		replayFile(replaySpeed, path)
	}
}

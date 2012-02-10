package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/couchbaselabs/go-couchbase"
	"github.com/dustin/gomemcached/client"
)

type vbmap map[string][]uint16

const commonSuffix = ".advertising.aol.com:11210"

func verify(vb map[string]vbmap) {
	accounted := make([]bool, 1024)
	for _, vbm := range vb {
		for _, vbid := range vbm["active"] {
			accounted[vbid] = true
		}
	}
	for vbid, isAccounted := range accounted {
		if !isAccounted {
			log.Printf("VB not accounted for:  %v", vbid)
		}
	}
}

func getVbMaps(bucket couchbase.Bucket) map[string]vbmap {

	type gathered struct {
		sn  string
		vbm vbmap
	}

	// Go grab all the things at once.
	ch := make(chan gathered)
	for _, serverName := range bucket.VBucketServerMap.ServerList {
		go func(s string) {
			sn := cleanupHost(s)
			results := make(map[string][]uint16)
			conn, err := memcached.Connect("tcp", s)
			if err != nil {
				log.Printf("Error getting stats from %v: %v",
					s, err)
				ch <- gathered{sn, results}
			} else {
				defer conn.Close()
				for _, statval := range conn.Stats("vbucket") {
					vb, err := strconv.ParseInt(statval.Key[3:], 10, 16)
					if err != nil {
						log.Fatalf("Error parsing vbucket:  %#v: %v", statval, err)
					}
					results[statval.Val] = append(results[statval.Val], uint16(vb))
				}
				ch <- gathered{sn, results}
			}
		}(serverName)
	}

	// Gather the results
	rv := map[string]vbmap{}
	for i := 0; i < len(bucket.VBucketServerMap.ServerList); i++ {
		g := <-ch
		if len(g.vbm) > 0 {
			rv[g.sn] = g.vbm
		}
	}

	verify(rv)
	return rv
}

func cleanupHost(h string) string {
	if strings.HasSuffix(h, commonSuffix) {
		return h[:len(h)-len(commonSuffix)]
	}
	return h
}

func getServerStates(bucket couchbase.Bucket) map[string]string {
	rv := make(map[string]string)
	for _, node := range bucket.Nodes {
		rv[cleanupHost(node.Hostname)] = node.Status
	}
	return rv
}

func getBucket() couchbase.Bucket {
	var err error
	client, err := couchbase.Connect(flag.Arg(0))
	if err != nil {
		log.Fatalf("Error connecting:  %v", err)
	}

	pool, err := client.GetPool("default")
	if err != nil {
		log.Fatalf("Error getting pool:  %v", err)
	}

	bucket, err := pool.GetBucket("default")
	if err != nil {
		log.Fatalf("Error getting bucket:  %v", err)
	}

	return bucket
}

func mapHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-type", "application/javascript")

	bucket := getBucket()

	fmt.Fprintf(w, "var vbmap = ")
	json.NewEncoder(w).Encode(getVbMaps(bucket))
	fmt.Fprintf(w, ";")

	fmt.Fprintf(w, "var server_states = ")
	json.NewEncoder(w).Encode(getServerStates(bucket))
	fmt.Fprintf(w, ";")
}

func protovisHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-type", "application/javascript")
	http.ServeFile(w, req, "protovis-r3.2.js")
}

func rootHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-type", "text/html")
	http.ServeFile(w, req, "root.html")
}

func main() {
	flag.Parse()

	http.HandleFunc("/", rootHandler)
	http.HandleFunc("/protovis.js", protovisHandler)
	http.HandleFunc("/map", mapHandler)
	log.Fatal(http.ListenAndServe(":4444", nil))
}

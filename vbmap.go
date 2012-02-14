package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"github.com/couchbaselabs/go-couchbase"
	"github.com/dustin/gomemcached/client"
)

type vbmap map[string][]uint16

var commonSuffix = ""

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

type gathered struct {
	sn  string
	vbm vbmap
}

func maybefatal(err error, f string, args ...interface{}) {
	if err != nil {
		log.Fatalf(f, args...)
	}
}

// Get an individual servers vbucket data and put the result in the given channel
func getVBucketData(addr string, ch chan<- gathered) {
	sn := couchbase.CleanupHost(addr, commonSuffix)
	results := make(map[string][]uint16)
	conn, err := memcached.Connect("tcp", addr)
	if err != nil {
		log.Printf("Error getting stats from %v: %v", addr, err)
		ch <- gathered{sn, results}
	} else {
		defer conn.Close()
		for _, statval := range conn.Stats("vbucket") {
			vb, err := strconv.ParseInt(statval.Key[3:], 10, 16)
			maybefatal(err, "Error parsing vbucket:  %#v: %v",
				statval, err)
			results[statval.Val] = append(results[statval.Val],
				uint16(vb))
		}
		ch <- gathered{sn, results}
	}
}

func getVbMaps(bucket couchbase.Bucket) map[string]vbmap {

	// Go grab all the things at once.
	ch := make(chan gathered)
	for _, serverName := range bucket.VBucketServerMap.ServerList {
		go getVBucketData(serverName, ch)
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

func getServerStates(bucket couchbase.Bucket) map[string]string {
	rv := make(map[string]string)
	for _, node := range bucket.Nodes {
		rv[couchbase.CleanupHost(node.Hostname, commonSuffix)] = node.Status
	}
	return rv
}

func getBucket() couchbase.Bucket {
	var err error
	client, err := couchbase.Connect(flag.Arg(0))
	maybefatal(err, "Error connecting:  %v", err)

	pool, err := client.GetPool("default")
	maybefatal(err, "Error getting pool:  %v", err)

	bucket, err := pool.GetBucket("default")
	maybefatal(err, "Error getting bucket:  %v", err)

	commonSuffix = bucket.CommonAddressSuffix()

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

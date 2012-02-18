package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"github.com/couchbaselabs/go-couchbase"
)

type vbmap map[string][]uint16

var commonSuffix = ""

func maybefatal(err error, f string, args ...interface{}) {
	if err != nil {
		log.Fatalf(f, args...)
	}
}

func getVbMaps(bucket *couchbase.Bucket) map[string]vbmap {

	allstats := bucket.GetStats("vbucket")

	rv := map[string]vbmap{}
	for fullname, m := range allstats {
		sn := couchbase.CleanupHost(fullname, commonSuffix)
		rv[sn] = vbmap{}

		for k, v := range m {
			vb, err := strconv.ParseInt(k[3:], 10, 16)
			maybefatal(err, "Error parsing vbucket:  %v/%v: %v",
				k, v, err)
			rv[sn][v] = append(rv[sn][v], uint16(vb))
		}
	}
	return rv
}

func getServerStates(bucket *couchbase.Bucket) map[string]string {
	rv := make(map[string]string)
	for _, node := range bucket.Nodes {
		rv[couchbase.CleanupHost(node.Hostname, commonSuffix)] = node.Status
	}
	return rv
}

func getBucket() *couchbase.Bucket {
	bucket, err := couchbase.GetBucket(flag.Arg(0), "default", "default")
	maybefatal(err, "Error getting bucket:  %v", err)

	commonSuffix = bucket.CommonAddressSuffix()

	return bucket
}

func mapHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-type", "application/javascript")

	bucket := getBucket()
	defer bucket.Close()

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

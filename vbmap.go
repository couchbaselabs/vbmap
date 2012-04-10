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

func getVbMapsMC(bucket *couchbase.Bucket) map[string]vbmap {

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

func getVbMaps(bucket *couchbase.Bucket) map[string]vbmap {
	rv := map[string]vbmap{}
	nodenames := []string{}
	for _, node := range bucket.VBucketServerMap.ServerList {
		name := couchbase.CleanupHost(node, commonSuffix)
		nodenames = append(nodenames, name)
		rv[name] = vbmap{}
	}
	for vbnum, nodes := range bucket.VBucketServerMap.VBucketMap {
		state := "active"
		for _, position := range nodes {
			if position >= 0 {
				prev, ok := rv[nodenames[position]][state]
				if !ok {
					prev = []uint16{}
				}
				rv[nodenames[position]][state] = append(prev,
					uint16(vbnum))
			}
			state = "replica"
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

func getShortServerList(bucket *couchbase.Bucket) []string {
	rv := []string{}
	for _, node := range bucket.VBucketServerMap.ServerList {
		rv = append(rv, couchbase.CleanupHost(node, commonSuffix))
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

	req.ParseForm()
	var_name := req.FormValue("name")

	rv := map[string]interface{}{}
	rv["vbmap"] = getVbMaps(bucket)
	// rv["mc_vbmap"] = getVbMapsMC(bucket)
	rv["server_list"] = getShortServerList(bucket)
	rv["repmap"] = bucket.VBucketServerMap.VBucketMap
	rv["server_states"] = getServerStates(bucket)

	if var_name != "" {
		fmt.Fprintf(w, "var "+var_name+" = ")
	}
	json.NewEncoder(w).Encode(rv)
	if var_name != "" {
		fmt.Fprintf(w, ";")
	}
}

func bucketHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-type", "application/javascript")

	bucket := getBucket()
	defer bucket.Close()

	fmt.Fprintf(w, "var bucketResponse = ")
	json.NewEncoder(w).Encode(bucket)
	fmt.Fprintf(w, ";\n")
}

func d3Handler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-type", "application/javascript")
	http.ServeFile(w, req, "d3.v2.min.js")
}

func repHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-type", "text/html")
	http.ServeFile(w, req, "rep.html")
}

func vbmapHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-type", "application/javascript")
	http.ServeFile(w, req, "vbmap.js")
}

func rootHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-type", "text/html")
	http.ServeFile(w, req, "root.html")
}

func main() {
	flag.Parse()

	http.HandleFunc("/", rootHandler)
	http.HandleFunc("/rep", repHandler)
	http.HandleFunc("/d3.js", d3Handler)
	http.HandleFunc("/vbmap.js", vbmapHandler)
	http.HandleFunc("/map", mapHandler)
	http.HandleFunc("/bucket", bucketHandler)
	log.Fatal(http.ListenAndServe(":4444", nil))
}

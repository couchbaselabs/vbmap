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

func maybefatal(err error, f string, args ...interface{}) {
	if err != nil {
		panic(fmt.Sprintf(f, args...))
	}
}

func getVbMapsMC(bucket *couchbase.Bucket, commonSuffixMC string) map[string]vbmap {

	allstats := bucket.GetStats("vbucket")

	rv := map[string]vbmap{}
	for fullname, m := range allstats {
		sn := couchbase.CleanupHost(fullname, commonSuffixMC)
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

func getVbMaps(bucket *couchbase.Bucket, commonSuffixCB string) map[string]vbmap {
	rv := map[string]vbmap{}
	nodenames := []string{}
	for _, node := range bucket.VBucketServerMap.ServerList {
		name := couchbase.CleanupHost(node, commonSuffixCB)
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

func getServerStates(bucket *couchbase.Bucket, commonSuffixMC string) map[string]string {
	rv := make(map[string]string)
	for _, node := range bucket.Nodes {
		rv[couchbase.CleanupHost(node.Hostname, commonSuffixMC)] = node.Status
	}
	return rv
}

func getShortServerList(bucket *couchbase.Bucket, commonSuffixMC string) []string {
	rv := []string{}
	for _, node := range bucket.VBucketServerMap.ServerList {
		rv = append(rv, couchbase.CleanupHost(node, commonSuffixMC))
	}
	return rv
}

func getBucket() *couchbase.Bucket {
	bucket, err := couchbase.GetBucket(flag.Arg(0), "default", "default")
	maybefatal(err, "Error getting bucket:  %v", err)

	return bucket
}

func mapHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-type", "application/javascript")

	bucket := getBucket()
	defer bucket.Close()

	commonSuffix := bucket.CommonAddressSuffix()
	commonSuffixMC := couchbase.FindCommonSuffix(bucket.VBucketServerMap.ServerList)

	req.ParseForm()
	var_name := req.FormValue("name")

	rv := map[string]interface{}{}
	rv["vbmap"] = getVbMaps(bucket, commonSuffixMC)
	// rv["mc_vbmap"] = getVbMapsMC(bucket, commonSuffixMC)
	rv["server_list"] = getShortServerList(bucket, commonSuffixMC)
	rv["repmap"] = bucket.VBucketServerMap.VBucketMap
	rv["server_states"] = getServerStates(bucket, commonSuffix)

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

type handler func(http.ResponseWriter, *http.Request)

func oneFile(name string, contentType string) handler {
	return func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-type", contentType)
		http.ServeFile(w, req, name)
	}
}

func main() {
	flag.Parse()

	http.HandleFunc("/", oneFile("root.html", "text/html"))
	http.HandleFunc("/rep", oneFile("rep.html", "text/html"))
	http.HandleFunc("/d3.js", oneFile("d3.v2.min.js", "application/javascript"))
	http.HandleFunc("/vbmap.js", oneFile("vbmap.js", "application/javascript"))
	http.HandleFunc("/map", mapHandler)
	http.HandleFunc("/bucket", bucketHandler)
	log.Fatal(http.ListenAndServe(":4444", nil))
}

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

func getBucket(req *http.Request) *couchbase.Bucket {
	req.ParseForm()
	clusterurl := req.Form.Get("cluster")
	if clusterurl == "" {
		clusterurl = flag.Arg(0)
	}
	bucketName := req.Form.Get("bucket")
	if bucketName == "" {
		bucketName = "default"
	}
	log.Printf("Getting bucket %v from %v", bucketName, clusterurl)
	bucket, err := couchbase.GetBucket(clusterurl, "default", bucketName)
	maybefatal(err, "Error getting bucket:  %v", err)

	return bucket
}

func mapHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-type", "application/javascript")

	bucket := getBucket(req)
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

type handler func(http.ResponseWriter, *http.Request)

func files(contentType string, paths ...string) handler {
	ch := make(chan string)
	go func() {
		for {
			for _, p := range paths {
				ch <- p
			}
		}
	}()

	return func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-type", contentType)
		// If there are multiple paths, we start returning
		// 304s for all requests very quickly.
		if len(paths) > 1 {
			req.Header.Del("If-Modified-Since")
		}

		// Ugly hack for variable definition type call.
		req.ParseForm()
		var_name := req.FormValue("name")
		if var_name != "" {
			fmt.Fprintf(w, "var "+var_name+" = ")
		}

		http.ServeFile(w, req, <-ch)

		if var_name != "" {
			fmt.Fprintf(w, ";")
		}
	}
}

func main() {
	staticPath := flag.Bool("static", false,
		"Interpret URL as a static path (for testing)")
	flag.Parse()

	http.HandleFunc("/", files("text/html", "root.html"))
	http.HandleFunc("/custom", files("text/html", "custom.html"))
	http.HandleFunc("/rep", files("text/html", "rep.html"))
	http.HandleFunc("/jquery.js", files("application/javascript", "jquery.min.js"))
	http.HandleFunc("/d3.js", files("application/javascript", "d3.v2.min.js"))
	http.HandleFunc("/vbmap.js", files("application/javascript", "vbmap.js"))

	if *staticPath {
		http.HandleFunc("/map", files("application/javascript", flag.Args()...))
	} else {
		http.HandleFunc("/map", mapHandler)
	}
	log.Fatal(http.ListenAndServe(":4444", nil))
}

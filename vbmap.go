package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"

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

	client, err := couchbase.Connect(clusterurl)
	maybefatal(err, "Error connecting to cluster: %v", err)
	pool, err := client.GetPool("default")
	maybefatal(err, "Error getting pool: %v", err)
	var bucket *couchbase.Bucket
	if bucketName == "" {
		for n, b := range pool.BucketMap {
			if bucket != nil {
				err = errors.New("Too many buckets found.")
			}
			bucketName = n
			bucket = &b
		}
	} else {
		bucket, err = pool.GetBucket(bucketName)
	}

	log.Printf("Got bucket %v from %v", bucketName, clusterurl)

	return bucket
}

func mapHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-type", "application/javascript")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	bucket := getBucket(req)
	defer bucket.Close()

	commonSuffix := bucket.CommonAddressSuffix()
	commonSuffixMC := couchbase.FindCommonSuffix(bucket.VBucketServerMap.ServerList)

	req.ParseForm()
	var_name := req.FormValue("name")

	rv := map[string]interface{}{}
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

type vbstats map[string]map[string]interface{}

func getVbStats(bucket *couchbase.Bucket, commonSuffixMC string) map[string]vbstats {

	allstats := bucket.GetStats("vbucket-details")

	rv := map[string]vbstats{}
	for fullname, m := range allstats {
		sn := couchbase.CleanupHost(fullname, commonSuffixMC)
		rv[sn] = vbstats{}

		for k, v := range m {
			var parts = strings.Split(k[3:], ":")
			vbbig, err := strconv.ParseInt(parts[0], 10, 16)
			maybefatal(err, "Error parsing vbucket:  %v/%v: %v",
				k, v, err)
			vb := fmt.Sprintf("%d", vbbig)
			label := "state"
			if len(parts) == 2 {
				label = parts[1]
			}
			d, ok := rv[sn][vb]
			if !ok {
				d = make(map[string]interface{})
				rv[sn][vb] = d
			}
			rv[sn][vb][label] = v
		}
	}
	return rv
}

func vbHandler(w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Content-type", "application/javascript")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	bucket := getBucket(req)
	defer bucket.Close()

	commonSuffixMC := couchbase.FindCommonSuffix(bucket.VBucketServerMap.ServerList)

	rv := map[string]interface{}{}
	rv["server_list"] = getShortServerList(bucket, commonSuffixMC)
	rv["stats"] = getVbStats(bucket, commonSuffixMC)

	req.ParseForm()
	var_name := req.FormValue("name")

	if var_name != "" {
		fmt.Fprintf(w, "var "+var_name+" = ")
	}
	err := json.NewEncoder(w).Encode(rv)
	maybefatal(err, "Error encoding output: %v", err)
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
	http.HandleFunc("/custom", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/static/custom.html", http.StatusMovedPermanently)
	})
	http.Handle("/static/", http.FileServer(http.Dir(".")))

	if *staticPath {
		http.HandleFunc("/map", files("application/javascript", flag.Args()...))
		http.HandleFunc("/vb", files("application/javascript", flag.Args()...))
	} else {
		http.HandleFunc("/map", mapHandler)
		http.HandleFunc("/vb", vbHandler)
	}
	log.Fatal(http.ListenAndServe(":4444", nil))
}

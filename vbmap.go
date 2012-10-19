package main

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
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

func displayMap(w http.ResponseWriter, req *http.Request, bucket *couchbase.Bucket) {
	commonSuffix := bucket.CommonAddressSuffix()
	commonSuffixMC := couchbase.FindCommonSuffix(bucket.VBucketServerMap.ServerList)

	rv := map[string]interface{}{}
	// rv["mc_vbmap"] = getVbMapsMC(bucket, commonSuffixMC)
	rv["server_list"] = getShortServerList(bucket, commonSuffixMC)
	rv["repmap"] = bucket.VBucketServerMap.VBucketMap
	rv["server_states"] = getServerStates(bucket, commonSuffix)

	sendJSON(w, req, rv)
}

func mapHandler(w http.ResponseWriter, req *http.Request) {
	defer func() {
		if x := recover(); x != nil {
			log.Printf("panic: recovering from %v", x)
		}
	}()
	bucket := getBucket(req)
	if bucket == nil {
		http.NotFound(w, req)
		return
	}
	defer bucket.Close()
	displayMap(w, req, bucket)
}

type vbstats map[string]map[string]interface{}

func processVBDetails(vbd map[string]map[string]string,
	commonSuffixMC string) map[string]vbstats {
	rv := map[string]vbstats{}
	for fullname, m := range vbd {
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

func getVbStats(bucket *couchbase.Bucket, commonSuffixMC string) map[string]vbstats {
	return processVBDetails(bucket.GetStats("vbucket-details"), commonSuffixMC)
}

func processGenericStats(in map[string]map[string]string, commonSuffixMC string) map[string]map[string]string {
	out := map[string]map[string]string{}
	for k, v := range in {
		out[couchbase.CleanupHost(k, commonSuffixMC)] = v
	}
	return out
}

func getStats(bucket *couchbase.Bucket, commonSuffixMC string) map[string]map[string]string {
	return processGenericStats(bucket.GetStats(""), commonSuffixMC)
}

func statsHandler(w http.ResponseWriter, req *http.Request) {
	defer func() {
		if x := recover(); x != nil {
			log.Printf("panic: recovering from %v", x)
		}
	}()
	bucket := getBucket(req)
	if bucket == nil {
		http.NotFound(w, req)
		return
	}
	defer bucket.Close()

	commonSuffixMC := couchbase.FindCommonSuffix(bucket.VBucketServerMap.ServerList)

	rv := getStats(bucket, commonSuffixMC)

	sendJSON(w, req, rv)
}

func vbHandler(w http.ResponseWriter, req *http.Request) {
	defer func() {
		if x := recover(); x != nil {
			log.Printf("panic: recovering from %v", x)
		}
	}()

	bucket := getBucket(req)
	defer bucket.Close()

	commonSuffixMC := couchbase.FindCommonSuffix(bucket.VBucketServerMap.ServerList)

	rv := getVbStats(bucket, commonSuffixMC)

	sendJSON(w, req, rv)
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

func replaymapHandler(w http.ResponseWriter, req *http.Request) {
	re := currentState.current()
	displayMap(w, req, &re.Bucket)
}

func replayvbHandler(w http.ResponseWriter, req *http.Request) {
	re := currentState.current()

	conv := map[string]map[string]string{}
	for s, m := range re.VBDetails {
		out, ok := conv[s]
		if !ok {
			out = make(map[string]string)
			conv[s] = out
		}
		for k, v := range m {
			out[k] = fmt.Sprintf("%v", v)
		}
	}

	vbd := processVBDetails(conv, "")

	sendJSON(w, req, vbd)
}

func replaystatsHandler(w http.ResponseWriter, req *http.Request) {
	re := currentState.current()

	conv := map[string]map[string]string{}
	for s, m := range re.All {
		out, ok := conv[s]
		if !ok {
			out = make(map[string]string)
			conv[s] = out
		}
		for k, v := range m {
			out[k] = fmt.Sprintf("%v", v)
		}
	}

	sendJSON(w, req, conv)
}

func sendJSON(w http.ResponseWriter, req *http.Request, ob interface{}) {
	acceptable := req.Header.Get("accept-encoding")
	z := strings.Contains(acceptable, "gzip")

	var out io.Writer = w

	w.Header().Set("Content-type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if z {
		w.Header().Set("Content-Encoding", "gzip")
		gz := gzip.NewWriter(w)
		defer gz.Close()
		out = gz
	}

	req.ParseForm()
	var_name := req.FormValue("name")

	if var_name != "" {
		fmt.Fprintf(out, "var "+var_name+" = ")
	}
	err := json.NewEncoder(out).Encode(ob)
	maybefatal(err, "Error encoding output: %v", err)
	if var_name != "" {
		fmt.Fprintf(out, ";")
	}
}

func main() {
	staticPath := flag.Bool("static", false,
		"Interpret URL as a static path (for testing)")
	replayPath := flag.Bool("replay", false,
		"Provide a replay json.gz for /map and /vb")
	replaySpeed := flag.Float64("replaySpeed", 1.0,
		"Realtime multiplier for replay")
	flag.Parse()

	http.HandleFunc("/", files("text/html", "root.html"))
	http.HandleFunc("/custom", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/static/custom.html", http.StatusMovedPermanently)
	})
	http.Handle("/static/", http.FileServer(http.Dir(".")))

	if *staticPath && *replayPath {
		log.Fatalf("Static and replay paths are mutually exclusive.")
	}

	switch {
	default:
		http.HandleFunc("/map", mapHandler)
		http.HandleFunc("/vb", vbHandler)
		http.HandleFunc("/stats", statsHandler)
	case *staticPath:
		http.HandleFunc("/map", files("application/json", flag.Args()...))
		http.HandleFunc("/vb", files("application/json", flag.Args()...))
		http.HandleFunc("/stats", files("application/json", flag.Args()...))
	case *replayPath:
		go startReplay(*replaySpeed, flag.Arg(0))
		http.HandleFunc("/map", replaymapHandler)
		http.HandleFunc("/vb", replayvbHandler)
		http.HandleFunc("/stats", replaystatsHandler)
	}

	log.Fatal(http.ListenAndServe(":4444", nil))
}

// statRequestBase = "http://cbvis.west.spy.net/stats";

function drawHorizon(here, clusterInfo) {

    var context = cubism.context()
        .step(1e4 * 5)
        .size(1440);

    d3.select(here).selectAll(".axis")
        .data(["top", "bottom"])
      .enter().append("div")
        .attr("class", function(d) { return d + " axis"; })
        .each(function(d) { d3.select(this).call(context.axis().ticks(12).orient(d)); });

    d3.select(here).append("div")
        .attr("class", "rule")
        .call(context.rule());

    context.on("focus", function(i) {
        d3.selectAll(".value").style("right", i == null ? null : context.size() - i + "px");
    });

    updaters.push(function(data) {
        var nodes = [];
        var things = ["net", "mem", "items", "ops"];
        for (var t = 0; t < things.length; t++) {
            for (var k in data) {
                nodes.push(k + " " + things[t]);
            }
        }

        d3.select(here).selectAll(".horizon")
            .data(nodes.map(justDoBoth))
          .enter().insert("div", ".bottom")
            .attr("class", "horizon")
            .call(context.horizon().height(30).extent(null));

            // d3.select(here).selectAll(".horizon")
            //     .data(d3.keys(data).map(nodeData))
            //   .exit().remove();
    });

    function justDoBoth(nodeNameThing) {
        var handlers = {
            net: networkBytes,
            mem: function(a, b) { return getStat(a, b, 'mem_used'); },
            items: function(a, b) { return getStat(a, b, 'curr_items'); },
            ops: function(a, b) {
                return sumStats(a, b,
                                [
                                    "cas_hits",
                                    "cas_misses",
                                    "decr_hits",
                                    "decr_misses",
                                    "delete_hits",
                                    "delete_misses",
                                    "get_hits",
                                    "get_misses",
                                    "incr_hits",
                                    "incr_misses",
                                    "cmd_set"
                                ]);
            }
        };
        var parts = nodeNameThing.split(" ");
        return handlers[parts[1]](parts[0], nodeNameThing);
    }

    function getStat(nodeName, label, stat) {
        return nodeData(nodeName, function(h) {
            return parseFloat(h[stat]);
        }, label);
    }

    function sum(a) {
        var rv = 0;
        for(var i = 0; i < a.length; i++) {
            rv += a[i];
        }
        return rv;
    }

    function sumStats(nodeName, label, stats) {
        var prev = NaN;
        var prevA = [];
        return nodeData(nodeName, function(h) {
            var vals = stats.map(function(s) { return parseFloat(h[s]); });
            var v = sum(vals);
            var rv = Math.max(0, isNaN(prev) ? NaN : v - prev);
            if (rv < 1 ) {
                console.log("sum(", prevA, ") - sum(", vals, ") =",
                            v, "-", prev, "=", rv);
            }
            prev = v;
            prev = vals;
            return rv;
        }, label);
    }

    function ops(nodeName, label) {
        var prev;
        return nodeData(nodeName, function(h) {
            var val = 0;
            for (var k in h) {
                if (k.match(/(cmd_|hits|misses)/)) {
                    val += parseFloat(h[k]);
                }
            }
            var rv = Math.max(0, isNaN(prev) ? NaN : val - prev);
            prev = val;
            return rv;
        }, label);
    }

    function networkBytes(nodeName, label) {
        var prev;
        return nodeData(nodeName, function(h) {
            var val = 0;
            for (var k in h) {
                if (k.substring(0, 6) === "bytes_") {
                    val += parseFloat(h[k]);
                }
            }
            var rv = isNaN(prev) ? NaN : val - prev;
            prev = val;
            return rv;
        }, label);
    }

    function nodeData(nodeName, extractf, label) {
        label = label || nodeName;
        return context.metric(function(start, stop, step, callback) {
            // console.log("Fetching data for", nodeName, "from", start, "to", stop);
            var sti = 0;
            while (sti < timestamps.length && timestamps[sti] < +start) {
                sti++;
            }
            var stuff = [];
            while (sti < timestamps.length && timestamps[sti] <= +stop) {
                var val = 0;
                if (statData[sti][nodeName]) {
                    stuff.push({key: timestamps[sti],
                                value: extractf(statData[sti][nodeName])});
                }
                sti++;
            }
            callback(null, binRows(stuff, start, step));
        }, label);
    }

    function diffs(vals) {
        if (vals.length < 2) {
            return [NaN];
        }
        var rv = [vals[0]];
        for (var i = 1; i < vals.length; i++) {
            rv.push(vals[i] - vals[i-1]);
        }
        return rv;
    }

    // Rewritten after staring at some jchris code for a while.
    function binRows(rows, start, step, stop) {
        var val = 0, vals = [];
        function rt(k) {
            //  0        1     2  3  4  5
            // ["Scala", 2012, 6, 1, 8, 0]
            return new Date(k[1], k[2] - 1, k[3], k[4] || 0, k[5] || 0).getTime();
        }
        var next = start.getTime() + step;
        for (var i=0; i < rows.length; i++) {
            var rowTime = rt(rows[i].key);
            if (rowTime > +stop) {
                break;
            }
            if (rowTime < next) {
                val += rows[i].value;
            } else {
                vals.push(val);
                while (next + step < rowTime) {
                    vals.push(NaN);
                    next += step;
                }
                next += step;
                val = rows[i].value;
            }
        };
        vals.push(val);
        return vals;
    }

}

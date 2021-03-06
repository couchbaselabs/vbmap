if(!Object.keys) Object.keys = function(o) {
    var ret=[],p;
    for(p in o) {
        if(Object.prototype.hasOwnProperty.call(o,p)) {
            ret.push(p);
        }
    }
    return ret;
};

// Base URL for all map requests.  Can allow for remote requests.
var mapRequestBase = "/map";
var vbStatRequestBase = "/vb";
var statRequestBase = "/stats";

function getClusterParams() {
    var s = document.location.search.substring(1);
    var parts = s.split("&");
    var rv = {};
    for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split('=', 2);
        rv[kv[0]] = unescape(kv[1]);
        if (kv[0] == 'cluster') {
            if (!/:/.test(rv[kv[0]])) {
                rv[kv[0]] += ":8091/";
            }
            if (!/^http:\/\//.test(rv[kv[0]])) {
                rv[kv[0]] = "http://" + rv[kv[0]];
            }
        }
    }
    return rv;
}

function computeNodeMap(vbmap, nodenames) {
    var rv = { };
    for (var vbnum = 0; vbnum < vbmap.length; vbnum++) {
        var state = "active";
        var nodes = vbmap[vbnum];
        for (var i = 0; i < nodes.length; i++) {
            var position = nodes[i];
            if (position >= 0) {
                var serverdata = rv[nodenames[position]];
                if (!serverdata) {
                    rv[nodenames[position]] = { };
                }
                var prev = rv[nodenames[position]][state] || [];
                prev.push(vbnum);
                rv[nodenames[position]][state] = prev;
            }
            state = "replica";
        }
    }
    return rv;
}

// Map request thing when using the vbmap server.
function doMapRequestVBMap(clusterInfo, fun, errfun, finfun) {
    var params="rand=" + Math.random();
    if (clusterInfo.cluster) {
        params += '&cluster=' + clusterInfo.cluster;
    }
    if (clusterInfo.bucket) {
        params += '&bucket=' + clusterInfo.bucket;
    }
    d3.json(mapRequestBase + "?" + params, function(json) {
        if (json != null) {
            json.vbmap = computeNodeMap(json.repmap, json.server_list);
            fun(json);
        } else if(errfun) {
            errfun();
        }
        if (finfun) {
            finfun();
        }
    });
}

// Map request thing when using the injection thing.
function doMapRequestInjection(clusterInfo, fun, errfun, finfun) {
    function deport(thing) {
        return thing.split(":")[0];
    }

    function deportList(things) {
        var rv = [];
        for (var i = 0; i < things.length; i++) {
            rv.push(deport(things[i]));
        }
        return rv;
    }

    InjectionController.slaveGet("/pools/default/buckets/" +
                                 encodeURIComponent(clusterInfo.bucket),
                                 function (json) {
                                     var data = {
                                         repmap: json.vBucketServerMap.vBucketMap,
                                         server_list: deportList(json.vBucketServerMap.serverList),
                                         server_states: {}
                                     };
                                     for (var i = 0; i < json.nodes.length; i++) {
                                         var node = json.nodes[i];
                                         data.server_states[deport(node.hostname)] = node.status;
                                     }
                                     data.vbmap = computeNodeMap(data.repmap, data.server_list);
                                     fun(data);
                                     if (finfun) {
                                         finfun();
                                     }
                                 });
}

function doMapRequest(clusterInfo, fun, errfun, finfun) {
    var injected = false;
    try {
        injected = InjectionController && true;
    } catch (ReferenceError) {
        injected = false;
    }
    if (injected) {
        doMapRequestInjection(clusterInfo, fun, errfun, finfun);
    } else {
        doMapRequestVBMap(clusterInfo, fun, errfun, finfun);
    }
}

function doVBStatRequest(clusterInfo, fun, errfun, finfun) {
    var params="rand=" + Math.random();
    if (clusterInfo.cluster) {
        params += '&cluster=' + clusterInfo.cluster;
    }
    if (clusterInfo.bucket) {
        params += '&bucket=' + clusterInfo.bucket;
    }
    d3.json(vbStatRequestBase + "?" + params, function(json) {
        if (json != null) {
            fun(json);
        } else if(errfun) {
            errfun();
        }
        if (finfun) {
            finfun();
        }
    });
}

function doGenericStatRequest(clusterInfo, st, fun, errfun, finfun) {
    var params="rand=" + Math.random();
    if (clusterInfo.cluster) {
        params += '&cluster=' + clusterInfo.cluster;
    }
    if (clusterInfo.bucket) {
        params += '&bucket=' + clusterInfo.bucket;
    }
    d3.json(statRequestBase + "?" + params, function(json) {
        if (json != null) {
            fun(json);
        } else if(errfun) {
            errfun();
        }
        if (finfun) {
            finfun();
        }
    });
}

function makeState(w, h, container) {

    function countChildren(d) {
            var rv = d.value || 0;
        var nodes = d.nodes ? d.nodes() : null;
        for (var n = 0; nodes && n < nodes.length; ++n) {
            if (typeof(nodes[n].nodeValue) == 'number') {
                rv += nodes[n].nodeValue;
            } else if (nodes[n].value) {
                rv += nodes[n].value;
            }
        }
        return rv;
    }

    function colorize(byState, sstate, d) {
        var name = d.nodeName ? d.nodeName : d.data.key;
        switch(name) {
          case "all vbuckets":
            var a = (byState['active'] || 0),
                r = (byState['replica'] || 0);
            if (a < sstate.repmap.length || a > r ) {
                return "#f77";
            } else {
                return "#ccf";
            }
          case "active":
            return "#9f9";
          case "replica":
            return "#99f";
          case "dead":
            return "#f99";
          case "pending":
            return "#ff9";
        default: // servers
            switch(sstate.server_states[name]) {
              case "unhealthy":
                return "#f77";
            default:
                return "#6a0";
            }
        }
    }

    function nodeName(byState, d) {
        var name = d.nodeName ? d.nodeName : d.data.key;
        if (name == 'all vbuckets') {
            var n=[];
            for (var s in byState) {
                n.push(s[0] + ": " + byState[s]);
            }
            return n.join(" ");
        } else {
            return name + " (" + countChildren(d) + ")";
        }
    }

    var r = Math.min(w, h) / 2, prevdata = null;

    d3.select(container).append("svg:svg")
        .attr("width", w)
        .attr("height", h)
      .append("svg:g")
        .attr("class", "container")
        .attr("transform", "translate(" + w / 2 + "," + h / 2 + ")");

    function update(sstate) {
        var data = {}, byState = {};

        for (var ip in sstate.vbmap) {
            var ob = {};
            var count = 0;
            for (var state in sstate.vbmap[ip]) {
                ob[state] = sstate.vbmap[ip][state].length;
                count += ob[state];
                if (state in byState) {
                    byState[state] += ob[state];
                } else {
                    byState[state] = ob[state];
                }
            }
            data[ip] = ob;
        }

        var partition = d3.layout.partition()
            .sort(null)
            .size([2 * Math.PI, r])
            .children(function(d) {
                var rv = isNaN(d.value) ? d3.entries(d.value) : null;
                if (rv) {
                    rv.sort(function(a, b) { return d3.ascending(a.key, b.key); });
                }
                return rv;
            })
            .value(function(d) { return d.value; });

        var arc = d3.svg.arc()
            .startAngle(function(d) { return d.x; })
            .endAngle(function(d) { return d.x + d.dx; })
            .innerRadius(function(d, i) { return d.y; })
            .outerRadius(function(d) { return d.y + d.dy; });

        var vis = d3.select(container + " g.container");

        var g = vis.data(d3.entries({"all vbuckets": data})).selectAll("g")
            .data(partition)
            .enter().append("svg:g");

        vis.data(d3.entries({"all vbuckets": data})).selectAll("g").data(partition).exit().remove();

        g.append("svg:path")
            .attr("d", arc)
            .attr("stroke", "#fff")
            .attr('fill', function(d) { return colorize(byState, sstate, d, Object.keys(data));});

        vis.selectAll("path")
            .data(partition)
            .attr('fill', function(d) { return colorize(byState, sstate, d, Object.keys(data));})
          .transition()
            .each("end", function() { prevdata = partition; })
            .duration(1000)
            .styleTween("fill", function(d, i, a) {
                var newColor = colorize(byState, sstate, d, Object.keys(data));
                return d3.interpolate(a, newColor);
            })
            .attrTween("d", function(d, i, a) {
                var target = arc(d, i);
                return d3.interpolate(a, target);
            });

        vis.selectAll("g text")
          .data(partition)
            .text(function(d) { return nodeName(byState, d);})
            .attr("x", function(d) { return d.y; })
            .attr("dx", "6") // margin
            .attr("dy", ".35em") // vertical-align
          .enter().append("text")
            .attr("text-anchor", function(d) { return d.y == 0 ? "middle" : null;})
            .attr("transform", function(d) {
                if (d.y == 0) {
                    return 0;
                }
                return "rotate(" + (d.x + d.dx / 2 - Math.PI / 2) / Math.PI * 180 + ")";
            })
            .attr("x", function(d) { return d.y; })
            .attr("dx", "6") // margin
            .attr("dy", ".35em") // vertical-align
            .text(function(d) { return nodeName(byState, d);});

        vis.selectAll("g text")
          .transition()
            .duration(1000)
            .attrTween("transform", function(d, i, a) {
                var target =  "rotate(" + (d.x + d.dx / 2 - Math.PI / 2) / Math.PI * 180 + ")";
                if (d.y == 0) {
                    target = 0;
                }
                return d3.interpolate(a, target);
            })
            .tween("text", function(d) {
                var target = nodeName(byState, d);
                var leaf = /^(active|replica|dead|pending)/.test(target);
                var i = d3.interpolate(this.textContent, nodeName(byState, d));
                return function(t) {
                    if (leaf) {
                        this.textContent = i(t).replace(/\.\d+/, '');
                    } else {
                        this.textContent = target;
                    }
                };
            });

        vis.selectAll("g text").data(partition).exit().remove();

    }
    return update;
}

function makeChord(w, h, container) {
    var padding = 0;
    var fill = 'black';
        var tooltip = { };
    var drawn = false;
    var hovering = -1;
    var prevarcs = null;
    var prevnodes = null;

    var chord = d3.layout.chord()
        .padding(padding)
        .sortSubgroups(d3.descending);

    var chordrv = function(sstate) {

        function buildMatrix(servers, mapping) {
            var m = new Array(servers.length);
            for (var i = 0; i < servers.length; i++) {
                m[i] = new Array(servers.length);
                for (var j = 0; j < servers.length; j++) {
                    m[i][j] = 0;
                }
            }
            for (var i = 0; i < mapping.length; i++) {
                if (mapping[i][1] >= 0) {
                    m[mapping[i][0]][mapping[i][1]]++;
                }
            }
            return m;
            }

        var vbmatrix = buildMatrix(sstate.server_list, sstate.repmap);

        chord.matrix(vbmatrix);

        var groups = chord.groups();
        var arcs = chord.chords();
        var arcLength = ((2.0 * Math.PI) - (groups.length * padding)) / groups.length;
        var start = 0;
        var positions = [],
        sizeFactors = [];

        for (var i = 0; i < groups.length; i++) {
            var origWidth = groups[i].endAngle - groups[i].startAngle;
            positions.push(start);
            groups[i].startAngle = start;
            groups[i].endAngle = start + arcLength;
            var newWidth = groups[i].endAngle - groups[i].startAngle;
            sizeFactors.push(newWidth / origWidth);
            start = start + arcLength + padding;
        }

        var allChordSegs = [];
        for (var i = 0; i < arcs.length; i++) {
            allChordSegs.push(arcs[i].source);
            allChordSegs.push(arcs[i].target);
            arcs[i].key = sstate.server_list[arcs[i].source.index] + "-" +
                sstate.server_list[arcs[i].target.index];
        }

        allChordSegs.sort(function(a, b) {
            return a.startAngle - b.startAngle;
        });

        for (var i = 0; i < allChordSegs.length; i++) {
            var seg = allChordSegs[i];
            var width = seg.endAngle - seg.startAngle;
            if (sizeFactors[seg.index] < 1.0) {
                width = width * sizeFactors[seg.index];
            }
            seg.startAngle = positions[seg.index];
            seg.endAngle = seg.startAngle + width;
            positions[seg.index] = seg.endAngle;
        }

        arcs.sort(function(a, b) {
            return a.startAngle - b.startAngle;
        });

        var r0 = Math.min(w, h) * .41,
        r1 = r0 * 1.1;

        var svg = d3.select(container + " svg g.canvas");

        for (var i = 0; i < groups.length; i++) {
            var d = groups[i];
            var vbin = 0,
            vbout = 0,
            vbtotal = (sstate.vbmap[sstate.server_list[i]]["active"] || []).length;
            for (var j = 0; j < sstate.server_list.length; j++) {
                vbout += vbmatrix[i][j];
                vbin += vbmatrix[j][i];
            }
            groups[i].angle = d.startAngle + ((d.endAngle - d.startAngle) / 2.0);
            groups[i].label = sstate.server_list[i] + " (a:" + vbtotal +
                ", out:" + vbout + ", in:" + vbin + ")";
            groups[i].state = vbtotal == vbout ? "good" : "bad";
            groups[i].color = vbtotal == vbout ? "grey" : "red";
        }

        if (!drawn) {
            svg = d3.select(container)
              .append("svg")
                .attr("width", w)
                .attr("height", h)
              .append("g")
                .attr("class", "canvas")
                .attr("transform", "translate(" + w / 2 + "," + h / 2 + ")");

            svg.append("g")
                .attr("class", "nodes");

            svg.append("g")
                .attr("class", "labels");

            svg.append("g")
                .attr("class", "chord");

            tooltip = svg.append("text")
                .attr("class", "tooltip")
                .attr("id", "tooltip")
                .attr("x", 0)
                .attr("y", 0)
                .attr("visibility", "hidden")
                .text("Tooltip");

            drawn = true;
        }

        var labels = svg.select("g.labels").selectAll("g.label")
            .data(groups);

        labels.enter().append("g")
            .attr("class", "label")
            .attr("transform", function(d) {
                return "rotate(" + (d.angle * 180 / Math.PI - 90) + ") "
                    + "translate(" + r1 + ",0)";
            })
          .append("text")
            .attr("text-anchor", "middle")
            .attr("transform", "rotate(90) translate(0, 20)");

        labels.exit().remove();

        labels.transition()
            .duration(1000)
            .ease('quad')
            .attrTween("transform", function(d, i, a) {
                var target = "rotate(" + (d.angle * 180 / Math.PI - 90) + ") "
                    + "translate(" + r1 + ",0)";
                return d3.interpolate(a, target);
            });

        svg.select("g.labels").selectAll("text")
            .data(groups)
            .text(function(d) { return d.label; });

        var nodes = svg.select("g.nodes").selectAll("path")
            .data(groups)
            .attr("d", d3.svg.arc().innerRadius(r0).outerRadius(r1))
            .attr("class", function(d, i) { return d.state; });

        nodes.enter().append("path")
            .attr("d", d3.svg.arc().innerRadius(r0).outerRadius(r1))
            .attr("class", function(d, i) { return d.state; })
            .on("mouseover", fade(.1))
            .on("mouseout", fade(1));

        nodes.transition()
            .each("end", function() { prevnodes = groups; })
            .duration(1000)
            .ease('quad')
            .attrTween("d", function(d, i, a) {
                var ip = d3.interpolate((prevnodes && prevnodes[i]) || d, d);
                return function(t) {
                    return d3.svg.arc().innerRadius(r0).outerRadius(r1)(ip(t), i);
                };
            })
            .styleTween("fill", function(d, i, a) {
                return d3.interpolate(a, d.color);
            });

        nodes.exit().remove();

        var chords = svg.selectAll("g.chord")
          .selectAll("path")
            .data(arcs, function(d, i) { return d.key; })
            .attr("d", d3.svg.chord().radius(r0))
            .style("opacity", function(d, i) {
                var hovered = hovering == -1 || d.source.index == hovering || d.target.index == hovering;
                return hovered ? 1 : 0.1;
            });

        chords.enter().append("path")
            .attr("d", d3.svg.chord().radius(r0))
            .style("fill", fill)
            .on("mouseover", function(d, i) {
                tooltip.attr("visibility", "visible");
                tooltip.text(d.source.value + " \u27f7 " + d.target.value);
                svg.selectAll("g.chord path")
                    .filter(function(di) {
                        return di.source != d.source && di.target != d.target;
                    })
                    .transition()
                    .style("opacity", 0.1);
            })
            .on("mousemove", function(d, i) {
                var evt = d3.mouse(this);
                tooltip.attr("x", evt[0]-8);
                tooltip.attr("y", evt[1]-5);
            })
            .on("mouseout", function() {
                tooltip.attr("visibility", "hidden");
                svg.selectAll("g.chord path")
                    .transition()
                    .style("opacity", 1);
            });

        chords.transition()
            .each("end", function() { prevarcs = arcs; })
            .duration(1000)
            .ease('back')
            .attrTween("d", function(d, i, a) {
                if (prevarcs == null) {
                    return function() {
                        return d3.svg.chord().radius(r0)(d, i);
                    };
                }
                return function(t) {
                    var b = d, a = prevarcs[i] || d;
                    var result = d3.interpolate(a, b)(t);
                    return d3.svg.chord().radius(r0)(result, i);
                };
            });

        chords.exit().remove();

        /** Returns an event handler for fading a given chord group. */
        function fade(opacity) {
            return function(g, i) {
                hovering = opacity == 1 ? -1 : i;
                svg.selectAll("g.chord path")
                    .filter(function(d) {
                        return d.source.index != i && d.target.index != i;
                    })
                    .transition()
                    .style("opacity", opacity);
            };
        }

    };

    chordrv.fill = function(value) {
        if (!arguments.length) return fill;
        fill = value;
        return chordrv;
    };

    return chordrv;
}

function makeVBThing(w, h, container) {
    var svg = d3.select(container + " svg g.canvas");
    svg = d3.select(container)
        .append("svg")
        .attr("width", w)
        .attr("height", h);

    svg.append("defs")
      .append("marker")
        .attr("id", "triangle")
        .attr("viewBox", "0 0 10 10")
        .attr("refX", 10)
        .attr("refY", 5)
        .attr("markerUnits", "strokeWidth")
        .attr("markerWidth", 10)
        .attr("markerHeight", 30)
        .attr("orient", "auto")
        .append("path")
          .attr("d", "M 0 0 L 10 5 L 0 10 z");

    svg = svg.append("g")
        .attr("class", "canvas")
        .attr("transform", "translate(" + w / 2 + "," + h / 2 + ")");

    svg.append("g")
        .attr("class", "labels");

    svg.append("g")
        .attr("class", "vbuckets");

    svg.append("g")
        .attr("class", "links");

    var tooltip = svg.append("g")
        .attr("class", "tooltip")
        .attr("id", "tooltip")
        .attr("visibility", "hidden");

    tooltip.append("rect")
        .attr("rx", 20)
        .attr("ry", 20)
        .attr("width", 200)
        .attr("height", 100);

    var vbuckets = [];

    var force = d3.layout.force()
        .nodes(vbuckets)
        .links([])
        .gravity(0)
        .size([w, h]);

    var distance = Math.min(w, h) / 4;
    var vbucketRadius = 3;
    var positions = [];
    var manualSelection = false;
    var selectedVB = -1;

    var prevj = "";

    var classOverride;

    var sstate;

    function update(st) {
        if (st) {
            sstate = st;
        }

        var somethingChanged = false;

        // These are positions as correlate to nodes.
        if (positions.length != sstate.server_list.length) {
            positions.length = 0;
            var angle = (Math.PI * 2) / sstate.server_list.length;
            var current = angle;
            for (var i = 0; i < sstate.server_list.length; i++) {
                var x = distance * Math.cos(current),
                    y = distance * Math.sin(current);
                positions.push({x: x, y: y});
                current += angle;
            }
            somethingChanged = true;
        }
        // Special case centering when there's only one.
        if (positions.length == 1) {
            positions[0].x = 0;
            positions[0].y = 0;
        }

        // These are vbuckets.
        var currentj = JSON.stringify(sstate.repmap);
        if (currentj != prevj) {
            var vbucketMap = {};
            for (var i = 0; i < vbuckets.length; i++) {
                var vb = vbuckets[i];
                vbucketMap[vb.vbid + "." + vb.which] = vb;
            }
            vbuckets.length = 0;
            for (var i = 0; i < sstate.repmap.length; i++) {
                for (var j = 0; j < sstate.repmap[i].length; j++) {
                    var k = i + "." + j;
                    var vb = vbucketMap[k] || { vbid: i, which: j };
                    var repcount = 0;

                    for (var j2 = 1; j2 < sstate.repmap[i].length; j2++) {
                        if (sstate.repmap[i][j2] != -1) {
                            repcount++;
                        }
                    }
                    vb.hasReplica = repcount > 0;
                    vbuckets.push(vb);
                }
            }

            somethingChanged = true;
            prevj = currentj;
        }

        force.on("tick", function(e) {
            // Push nodes toward their designated focus.
            var k = .9 * e.alpha;
            vbuckets.forEach(function(o, i) {
                var sid = sstate.repmap[o.vbid][o.which];
                var gpoint = sid >= 0 ? positions[sid] : null;
                if (gpoint) {
                    o.y += (gpoint.y - o.y) * k;
                    o.x += (gpoint.x - o.x) * k;
                } else {
                    // Keep non-displayed nodes from floating away forever.
                    if (Math.abs(o.x) > w || Math.abs(o.y) > h) {
                        o.x = o.px;
                        o.y = o.py;
                    }
                }
            });

            svg.selectAll("circle")
                .attr("cx", function(d) { return d.x; })
                .attr("cy", function(d) { return d.y; })
                .each(function(d) {
                    if (d.vbid == selectedVB) {
                        update.updateSelectionLine();
                    }
                });
        });

        if (somethingChanged) {
            force.start();
        }

        var labels = svg.select("g.labels").selectAll("text")
            .data(positions);

        labels.enter().append("text")
            .attr("x", 0)
            .attr("y", 0)
            .attr("text-anchor", "middle");

        labels.text(function(d, i) { return sstate.server_list[i]; });

        labels.transition()
            .duration(1000)
            .attr("x", function(d) { return d.x; })
            .attr("y", function(d) { return d.y; });

        labels.exit().remove();

        var circles = svg.select("g.vbuckets").selectAll("circle")
            .data(vbuckets);

        // I don't want to use standard force drag because the cursor has a
        // bit of repulsion so it chases around the vbuckets a bit while
        // I'm trying to point at them.  Instead, I just pause the force simulation
        // and then resume it when I leave.  However, I don't want it to resume
        // instantly, so I wait up to about 500ms after I stop pointing at things
        // for the motion to resume.
        var resuming = null;
        var resumingTo = -1;

        update.updateSelectionLine = function() {
            var primary = null;
            var participants = [];
            if (selectedVB >= 0) {
                for (var i = 0; i < vbuckets.length; i++) {
                    var vb = vbuckets[i];
                    if (vb.vbid == selectedVB) {
                        if (vb.which == 0) {
                            primary = vb;
                        } else if (sstate.repmap[vb.vbid][vb.which] >= 0) {
                            participants.push(vb);
                        }
                    }
                }
            }
            d3.select("g.links").selectAll("line").data(participants)
              .enter().append("line")
                .attr("stroke", "black")
                .attr("marker-end", "url(#triangle)");

            d3.select("g.links").selectAll("line").data(participants)
                .exit().remove();

            if (primary) {
                d3.select("g.links").selectAll("line").data(participants)
                    .attr("x1", primary.x)
                    .attr("y1", primary.y)
                    .attr("x2", function(d) { return d.x; })
                    .attr("y2", function(d) { return d.y; });
            }
        };

        update.select = function(vbid, manual) {
            if (arguments.length == 1) { manual = true; }
            if (manual || !manualSelection) {
                svg.selectAll("g.vbuckets circle")
                    .attr("r", function(di) {
                        return di.vbid == vbid ? vbucketRadius * 2 : vbucketRadius;
                    })
                    .style("opacity", function(di) {
                        return di.vbid == vbid ? null : 0.1;
                    });
                manualSelection = manual;
                selectedVB = vbid;
                update.updateSelectionLine();
            }
        };

        update.unselect = function(manual) {
            if (arguments.length == 0) { manual = true; }
            if (manual || !manualSelection) {
                svg.selectAll("g.vbuckets circle")
                    .attr("r", vbucketRadius)
                    .style("opacity", null);
                manualSelection = manual;
                selectedVB = -1;
                update.updateSelectionLine();
            }
        };

        circles.enter().append("svg:circle")
            .attr("r", vbucketRadius)
            .attr("cx", function(d) { return d.x; })
            .attr("cy", function(d) { return d.y; })
            .on("mousemove", function(d, i) {
                var evt = d3.mouse(this);
                tooltip.attr("transform", "translate(" + evt[0] + "," + evt[1] + ")");
            })
            .on("mouseout", function() {
                resuming = setTimeout(function() {
                    force.alpha(resumingTo);
                    resumingTo = -1;
                }, 500);
                tooltip.attr("visibility", "hidden");
                update.unselect(false);
            });

        circles.data(vbuckets)
            .attr("class", function(d) {
                var c = d.hasReplica ? ('rep' + d.which) : 'noreplica';
                if (classOverride) {
                    c = c + " " + classOverride(d, c);
                }
                return c;
            })
            .on("mouseover", function(d, i) {
                var m = sstate.repmap[d.vbid];
                if (resuming != null) {
                    clearTimeout(resuming);
                    resuming = null;
                }
                resumingTo = Math.max(force.alpha(), resumingTo);
                force.stop();
                var textData = ["vb: " + d.vbid,
                                "primary: " + sstate.server_list[m[0]]];
                for (var j = 1; j < m.length; j++) {
                    if (m[j] >= 0) {
                        textData.push(" rep #" + j + ": " +
                                      sstate.server_list[m[j]]);
                    }
                }
                tooltip.attr("visibility", "visible");
                tooltip.selectAll("text").remove();
                tooltip.selectAll("text")
                    .data(textData)
                    .enter().append("text")
                    .attr("x", 10)
                    .attr("y", function(dd, ii) { return (ii + 2) * 15; })
                    .text(function(dd) {return dd;});
                update.select(d.vbid, false);
            });

        circles.exit().remove();
    }

    update.overrideClass = function(f) {
        classOverride = f;
    };

    return update;
}

function makeVBStatThing(totalWidth, h, container) {
    var chart = d3.select(container + " svg g.canvas");
    chart = d3.select(container)
        .append("svg")
        .attr("width", w)
        .attr("height", h)
      .append("g")
        .attr("transform", "translate(50, 15)");

    var w = 5;

    var x;
    var y;

    var color = d3.scale.category20();

    var maxvalues = {};

    chart.append("g").attr("class", "rulex");
    chart.append("g").attr("class", "ruley");
    chart.append("g").attr("class", "plot");

    function update(json, stat) {
        var maxvalue = 0;
        update.color = color;
        var data = [];
        var masters = {};
        update.total = 0;
        update.largeV = 0, update.largeN = 0, update.smallV = 0, update.smallN = 10000000000000;
        for (var node in json) {
            var nstates = json[node];
            for (var vbid in nstates) {
                if (nstates[vbid].state === 'active') {
                    masters[vbid] = node;
                    var n = parseInt(nstates[vbid][stat]);
                    if (n > update.largeN) {
                        update.largeN = n;
                        update.largeV = vbid;
                    }
                    if (n < update.smallN) {
                        update.smallN = n;
                        update.smallV = vbid;
                    }
                    data[vbid] = n;
                    update.total += n;
                    maxvalue = Math.max(maxvalue, n);
                }
            }
        }

        var mva = maxvalues[stat] || [];
        mva.push(maxvalue);
        if (mva.length > 10) {
            mva.shift();
        }
        maxvalues[stat] = mva;
        maxvalue = d3.max(maxvalues[stat]);

        function master(n) {
            return masters[n];
        }

        w = Math.max(2, Math.floor(totalWidth / data.length));

        x = d3.scale.linear()
            .domain([0, 1])
            .range([0, w]);

        y = d3.scale.linear()
            .domain([0, maxvalue])
            .rangeRound([0, h]);

        chart.select(".plot").selectAll("rect")
            .data(data)
          .enter().append("rect")
            .attr("x", function(d, i) { return x(i) - .5; })
            .attr("y", function(d) { return h - y(d) - .5; })
            .attr("width", w)
            .attr("height", function(d) { return y(d); })
            .style("fill", function(d, i) { return color(master(i));});

        chart.select(".plot").selectAll("rect")
            .data(data)
          .transition()
            .duration(1000)
            .style("fill", function(d, i) { return color(master(i));})
            .attr("y", function(d) { return h - y(d) - .5; })
            .attr("height", function(d) { return y(d); });

        var ruler = d3.scale.linear()
            .domain([0, data.length])
            .range([0, data.length]);

        chart.select(".rulex").selectAll("line")
            .data(ruler.ticks(10))
          .enter().append("line")
            .attr("x1", x)
            .attr("x2", x)
            .attr("y1", 0)
            .attr("y2", h)
            .style("stroke", "#ccc");

        chart.select(".rulex").selectAll(".rulex")
            .data(ruler.ticks(10))
          .enter().append("text")
            .attr("class", "rulex")
            .attr("x", x)
            .attr("y", 0)
            .attr("dy", -3)
            .attr("text-anchor", "middle")
            .text(function(d) { return d > 0 ? d : ""; });

        chart.select(".ruley").selectAll("line")
            .data(y.ticks(10))
          .enter().append("line")
            .attr("x1", 0)
            .attr("x2", totalWidth)
            .attr("y1", y)
            .attr("y2", y)
            .style("stroke", "#ccc");

        chart.select(".ruley").selectAll("line")
            .data(y.ticks(10))
            .attr("y1", y)
            .attr("y2", y);

        chart.select(".ruley").selectAll("line")
            .data(y.ticks(10))
          .exit().remove();

        chart.select(".ruley").selectAll(".rule")
            .data(y.ticks(10))
          .enter().append("text")
            .attr("class", "rule")
            .attr("x", 0)
            .attr("dx", -25)
            .attr("y", y)
            .attr("text-anchor", "middle")
            .text(function(d) { return maxvalue - d; });

        chart.select(".ruley").selectAll(".rule")
            .data(y.ticks(10))
            .attr("y", y)
            .text(function(d) { return d3.format("0.2s")(maxvalue - d); });

        chart.select(".ruley").selectAll(".rule")
            .data(y.ticks(10))
            .exit().remove();
    }

    return update;
}

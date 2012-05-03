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

function doMapRequest(clusterInfo, fun, errfun, finfun) {
    var params="rand=" + Math.random();
    if (clusterInfo.cluster) {
        params += '&cluster=' + clusterInfo.cluster;
    }
    if (clusterInfo.bucket) {
        params += '&bucket=' + clusterInfo.bucket;
    }
    d3.json(mapRequestBase + "?" + params, function(json) {
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
            .children(function(d) { return isNaN(d.value) ? d3.entries(d.value) : null; })
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
        .attr("height", h)
      .append("g")
        .attr("class", "canvas")
        .attr("transform", "translate(" + w / 2 + "," + h / 2 + ")");

    svg.append("g")
        .attr("class", "labels");

    svg.append("g")
        .attr("class", "vbuckets");

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
    var positions = [];
    var recentState = [];

    force.on("tick", function(e) {

        // Push nodes toward their designated focus.
        var k = .9 * e.alpha;
        vbuckets.forEach(function(o, i) {
            if (recentState[o.vbid][o.which] >= 0) {
                o.y += (positions[recentState[o.vbid][o.which]].y - o.y) * k;
                o.x += (positions[recentState[o.vbid][o.which]].x - o.x) * k;
            }
        });

        svg.selectAll("circle")
            .attr("cx", function(d) { return d.x; })
            .attr("cy", function(d) { return d.y; });
    });

    var prevj = "";

    function update(sstate) {

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
        }
        // Special case centering when there's only one.
        if (positions.length == 1) {
            positions[0].x = 0;
            positions[0].y = 0;
        }

        // These are vbuckets.
        var currentj = JSON.stringify(sstate.repmap);
        if (currentj != prevj) {
            if (vbuckets.length > sstate.repmap.length) {
                vbuckets.length = sstate.repmap.length;
            } else if (vbuckets.length < sstate.repmap.length) {
                for (var i = vbuckets.length; i < sstate.repmap.length; i++) {
                    for (var j = 0; j < sstate.repmap[i].length; j++) {
                        vbuckets.push({vbid: i, which: j});
                    }
                }
            }
            for (var i = 0; i < vbuckets.length; i++) {
                var repcount = 0;
                var vb = vbuckets[i].vbid;
                for (var j = 1; j < sstate.repmap[vb].length; j++) {
                    if (sstate.repmap[vb][j] != -1) {
                        repcount++;
                    }
                }
                vbuckets[i].hasReplica = repcount > 0;
            }
            force.start();
            prevj = currentj;
        }

        recentState = sstate.repmap;

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

        circles.enter().append("svg:circle")
            .attr("r", 3)
            .attr("cx", function(d) { return d.x; })
            .attr("cy", function(d) { return d.y; })
            .attr("class", function(d) {
                return d.hasReplica ? ('rep' + d.which) : 'noreplica';
            })
            .on("mouseover", function(d, i) {
                var m = sstate.repmap[d.vbid];
                if (resuming != null) {
                    clearTimeout(resuming);
                    resuming = null;
                }
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
                svg.selectAll("g.vbuckets circle")
                    .filter(function(di) { return di.vbid != d.vbid; })
                    .style("opacity", 0.1);

            })
            .on("mousemove", function(d, i) {
                var evt = d3.mouse(this);
                tooltip.attr("transform", "translate(" + (evt[0]-8) + "," + (evt[1]-5) + ")");
            })
            .on("mouseout", function() {
                resuming = setTimeout(force.resume, 500);
                tooltip.attr("visibility", "hidden");
                svg.selectAll("g.vbuckets circle")
                    .style("opacity", null);
            });

        circles.exit().remove();
    }

    return update;
}
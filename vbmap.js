if(!Object.keys) Object.keys = function(o) {
    var ret=[],p;
    for(p in o) {
        if(Object.prototype.hasOwnProperty.call(o,p)) {
            ret.push(p);
        }
    }
    return ret;
};

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

function colorize(server_states, d) {
    var name = d.nodeName ? d.nodeName : d.data.key;
    switch(name) {
      case "all vbuckets":
        return "#ccf";
      case "active":
        return "#9f9";
      case "replica":
        return "#99f";
      case "dead":
        return "#f99";
      case "pending":
        return "#ff9";
    default: // servers
        switch(server_states[name]) {
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

function drawState(w, h, sstate, container) {
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

    var r = Math.min(w, h) / 2, color = d3.scale.category20c();

    var vis = d3.select(container).append("svg:svg")
        .attr("width", w)
        .attr("height", h)
      .append("svg:g")
        .attr("transform", "translate(" + w / 2 + "," + h / 2 + ")");

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

    var g = vis.data(d3.entries({"all vbuckets": data})).selectAll("g")
        .data(partition)
      .enter().append("svg:g");

    g.append("svg:path")
        .attr("d", arc)
        .attr("stroke", "#fff")
        .attr('fill', function(d) { return colorize(sstate.server_states, d, Object.keys(data));})
        .attr("fill-rule", "evenodd");

    g.append("svg:text")
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
}

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

function makeChord(w, h, container) {
    var padding = 0;
    var fill = 'black';
    var tooltip = { };
    var drawn = false;
    var hovering = -1;
    var prevarcs = null;

    var chord = d3.layout.chord()
        .padding(padding)
        .sortSubgroups(d3.descending);

    var chordrv = function(sstate) {
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
            groups[i].ip = sstate.server_list[i];
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
            .data(groups, function() { return d.ip; } );

        labels.enter().append("g")
            .attr("class", "label")
            .attr("transform", function(d) {
                return "rotate(" + (d.angle * 180 / Math.PI - 90) + ")"
                    + "translate(" + r1 + ",0)";
            })
            .append("text")
            .text(function(d, i) { return d.label; })
            .attr("text-anchor", "middle")
            .attr("transform", "rotate(90) translate(0, 20)");

        labels.exit().remove();

        labels.selectAll("text").text(function(d, i) { return d.label; });

        var nodes = svg.select("g.nodes").selectAll("path")
            .data(groups)
            .attr("class", function(d, i) { return d.state; });

        nodes.enter().append("path")
            .attr("d", d3.svg.arc().innerRadius(r0).outerRadius(r1))
            .attr("class", function(d, i) { return d.state; })
            .on("mouseover", fade(.1))
            .on("mouseout", fade(1));

        nodes.transition()
            .duration(1000)
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
            .attrTween("d", function(d, i, a) {
                if (prevarcs == null) {
                    return function() {
                        return d3.svg.chord().radius(r0)(d, i);
                    };
                }
                return function(t) {
                    var a = prevarcs[i], b = d;
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
function getBucketMapping() {
  return bucketResponse.vBucketServerMap;
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
        m[mapping[i][0]][mapping[i][1]]++;
    }
    return m;
}

function reload() {
    var vbm = getBucketMapping();
    var m = buildMatrix(vbm.serverList, vbm.vBucketMap);
    m[0][1] = 5;
    m[0][2] = 3;
    m[0][3] = 2;
    m[0][4] = 2;
    m[2][0] = 12;
    return m;
}

function makeChord(w, h, vbm, container, fill) {
    var vbmatrix = buildMatrix(vbm.serverList, vbm.vBucketMap);

    var padding = 0.05;

    var chord = d3.layout.chord()
        .padding(padding)
        .sortSubgroups(d3.descending)
        .matrix(vbmatrix);

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

    var svg = d3.select(container)
      .append("svg")
        .attr("width", w)
        .attr("height", h)
      .append("g")
        .attr("transform", "translate(" + w / 2 + "," + h / 2 + ")");

  svg.append("g")
    .selectAll("path")
      .data(chord.groups)
    .enter().append("path")
      .style("fill", function(d) { return fill(d.index); })
      .style("stroke", function(d) { return fill(d.index); })
      .attr("class", "node")
      .attr("d", d3.svg.arc().innerRadius(r0).outerRadius(r1))
      .on("mouseover", fade(.1))
      .on("mouseout", fade(1));

  var labels = svg.append("g")
    .selectAll("path")
      .data(chord.groups)
    .enter().append("g")
    .selectAll("g")
      .data(groupTicks)
    .enter().append("g")
      .attr("transform", function(d) {
        return "rotate(" + (d.angle * 180 / Math.PI - 90) + ")"
            + "translate(" + r1 + ",0)";
      });

  labels.append("text")
      .attr("text-anchor", "middle")
      .attr("transform", "rotate(90) translate(0, 20)")
      .text(function(d, i) { return d.label; });

  var chords = svg.append("g")
      .attr("class", "chord")
    .selectAll("path")
      .data(chord.chords)
    .enter().append("path")
      .style("fill", function(d) { return fill(d.target.index); })
      .attr("d", d3.svg.chord().radius(r0))
      .style("opacity", 1)
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

  var tooltip = svg.append("text")
      .attr("class", "tooltip")
      .attr("id", "tooltip")
      .attr("x", 0)
      .attr("y", 0)
      .attr("visibility", "hidden")
      .text("Tooltip");

  /** Returns an array of tick angles and labels, given a group. */
  function groupTicks(d, i) {
    var vbin = 0, vbout = 0;
    for (var j = 0; j < vbm.serverList.length; j++) {
        vbout += vbmatrix[i][j];
        vbin += vbmatrix[j][i];
    }
    return [{
        angle: d.startAngle + ((d.endAngle - d.startAngle) / 2.0),
        label: vbm.serverList[i] + " (a:" + vbout + ", r:" + vbin + ")"
    }];
  }

  /** Returns an event handler for fading a given chord group. */
  function fade(opacity) {
    return function(g, i) {
      svg.selectAll("g.chord path")
          .filter(function(d) {
            return d.source.index != i && d.target.index != i;
          })
        .transition()
          .style("opacity", opacity);
    };
  }
}

var brews11 = ['#A6CEE3', '#1F78B4', '#B2DF8A', '#33A02C',
               '#FB9A99', '#E31A1C', '#FDBF6F', '#FF7F00',
               '#CAB2D6', '#6A3D9A', '#FFFF99'];

var brews11_2 = ['#8DD3C7', '#FFFFB3', '#BEBADA', '#FB8072',
                 '#80B1D3', '#FDB462', '#B3DE69', '#FCCDE5',
                 '#D9D9D9', '#BC80BD', '#CCEBC5'];

var brews12 = ['#8DD3C7', '#FFFFB3', '#BEBADA', '#FB8072',
               '#80B1D3', '#FDB462', '#B3DE69', '#FCCDE5',
               '#D9D9D9', '#BC80BD', '#CCEBC5', '#FFED6F'];

var fill = d3.scale.ordinal()
    .domain(d3.range(4))
    .range(brews11_2);

var chord = makeChord(800, 800, getBucketMapping(), '#chart', fill);

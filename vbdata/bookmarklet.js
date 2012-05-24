var clusterInfo = {
    cluster: "bookmarklet",
    bucket: "default"
};

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

function fetchData(fun, errfun, finfun) {
    InjectionController.slaveGet("/diag/vbuckets?bucket=" +
                                 encodeURIComponent(clusterInfo.bucket),
                                 fun);
}

function initialize() {
    var levels = $("#levels");

    var totalWidth = window.innerWidth - 220;
    var w = 5, h = 600;

    levels.width(totalWidth);

    var maxvalue = 1;

    var x;
    var y;

    var color = d3.scale.category20();

    var chart = d3.select("#levels").append("svg")
        .attr("class", "chart")
        .attr("width", totalWidth)
      .append("g")
        .attr("transform", "translate(50,15)");

    chart.append("g").attr("class", "rulex");
    chart.append("g").attr("class", "ruley");
    chart.append("g").attr("class", "plot");

    function updateGraphs(json) {
        var data = [];
        for (var i = 0; i < json.bucketMap.length; i++) {
            data.push(0);
        }
        var nodeNames=[];
        for (var node in json.perNodeStates) {
            nodeNames.push(node);
            var nstates = json.perNodeStates[node];
            for (var vbid in nstates) {
                data[vbid] = nstates[vbid].reported;
                maxvalue = Math.max(maxvalue, nstates[vbid].reported);
            }
        }

        var legend = d3.select("#nodes").selectAll("li").data(nodeNames);
        legend.enter().append("li");

        legend.text(String)
            .style("color", function(d) { return color(d); });

        legend.exit().remove();

        w = Math.max(2, Math.floor(totalWidth / json.bucketMap.length));

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
            .style("fill", function(d, i) { return color(json.bucketMap[i][0]);});

        chart.select(".plot").selectAll("rect")
            .data(data)
          .transition()
            .duration(1000)
            .style("fill", function(d, i) { return color(json.bucketMap[i][0]);})
            .attr("y", function(d) { return h - y(d) - .5; })
            .attr("height", function(d) { return y(d); });

        var ruler = d3.scale.linear()
            .domain([0, json.bucketMap.length])
            .range([0, json.bucketMap.length]);

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
            .attr("dx", -18)
            .attr("y", y)
            .attr("text-anchor", "middle")
            .text(String);

        chart.select(".ruley").selectAll(".rule")
            .data(y.ticks(10))
            .attr("y", y)
            .text(String);

        chart.select(".ruley").selectAll(".rule")
            .data(y.ticks(10))
            .exit().remove();

        $("#loading").hide();
    }

    fetchData(updateGraphs);

    setInterval(function() {
        fetchData(updateGraphs);
    }, 2000);
}

InjectionController.onConnected = initialize;
InjectionController.init();

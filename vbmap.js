var byState = {};

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
    var rv = 0;
    var nodes = d.nodes();
    for (var n = 0; n < nodes.length; ++n) {
        if (typeof(nodes[n].nodeValue) == 'number') {
            rv += nodes[n].nodeValue;
        }
    }
    return rv;
}

function colorize(d, ips) {
    switch(d.nodeName) {
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
        switch(server_states[d.nodeName]) {
          case "unhealthy":
            return "#f77";
        default:
            return "#6a0";
        }
    }
}

function nodeName(d) {
    if (d.nodeName == 'all vbuckets') {
        var n=[];
        for (var s in byState) {
            n.push(s[0] + ": " + byState[s]);
        }
        return n.join(" ");
    } else {
        return d.nodeName + " (" + countChildren(d) + ")";
    }
}

function drawState(w, h) {
    var data = {};
    for (var ip in vbmap) {
        var ob = {};
        var count = 0;
        for (var state in vbmap[ip]) {
            ob[state] = vbmap[ip][state].length;
            count += ob[state];
            if (state in byState) {
                byState[state] += ob[state];
            } else {
                byState[state] = ob[state];
            }
        }
        data[ip] = ob;
    }

    var vis = new pv.Panel()
        .width(w)
        .height(h)
        .bottom(0);

    var partition = vis.add(pv.Layout.Partition.Fill)
        .nodes(pv.dom(data).root("all vbuckets").nodes())
        .size(countChildren)
        .order("descending")
        .orient("radial");

    partition.node.add(pv.Wedge)
        .fillStyle(function(d) { return colorize(d, Object.keys(data));})
        .strokeStyle("#fff")
        .lineWidth(.5);

    partition.label.add(pv.Label)
        .text(nodeName)
        .visible(function(d) { return d.angle * d.outerRadius >= 6; });

    vis.render();
}
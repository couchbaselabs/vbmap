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

function initialize() {
    $("#clusterid").val(clusterInfo.cluster);
    $("#bucketid").val(clusterInfo.bucket || 'default');

    $("#force").attr("width", window.innerWidth - 170);
    var forcething = makeVBThing(window.innerWidth - 170,
                                 window.innerHeight - 40, '#force');

    $("#vbucketfinder").on("submit", function() {
        var vb = $("#findvb").val();
        if (vb === "") {
            forcething.unselect();
        } else {
            forcething.select(vb);
        }
        return false;
    });

    function updateGraphs(json) {
        console.log("Updating with", json);
        forcething(json);
        var ids = ['#numnorep', '#numrep0', '#numrep1', '#numrep2', '#numrep3'];
        var counts = [0, 0, 0, 0, 0];
        for (var i = 0; i < json.repmap.length; i++) {
            var rmi = json.repmap[i];
            var hasRep = false;
            for (var j = 0; j < rmi.length; j++) {
                if (rmi[j] >= 0) {
                    counts[j+1]++;
                    if (j > 0) {
                        hasRep = true;
                    }
                }
            }
            if (!hasRep) {
                counts[0]++;
            }
        }
        for (var i = 0; i < counts.length; i++) {
            $(ids[i]).text(counts[i]);
        }
        $("#loading").hide();
    }

    fetchData(updateGraphs);

    setInterval(function() {
        fetchData(updateGraphs);
    }, 2000);
}

InjectionController.onConnected = initialize;
InjectionController.init();

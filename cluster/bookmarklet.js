var clusterInfo = {
    cluster: "bookmarklet",
    bucket: "default"
};

function initialize() {
    var imgdim = Math.round((window.innerWidth / 2) - 20);

    var state = makeState(imgdim, imgdim, '#cluster');

    function updateGraphs(json) {
        state(json);
        $("#loading").hide();
    }

    doMapRequest(clusterInfo, updateGraphs);

    setInterval(function() {
        doMapRequest(clusterInfo, updateGraphs);
    }, 2000);
}

InjectionController.onConnected = initialize;
InjectionController.init();

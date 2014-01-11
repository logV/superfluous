"use strict";

module.exports = {
  tagName: "div",
  className: "",
  defaults: {
    content: ""
  },
  client: function(options) {
    this.$el.find(".toc").empty();

    // For now, let's just wrap content div
    var $el = $(options.div);
    var headers = $el.find("h1, h2, h3, h4");
    var contents = $("<ul />");
    contents.addClass("nav");
    contents.addClass("nav-stacked");

    _.each(headers, function(heading) {
      var hId = _.uniqueId("sidebar_anchor");
      var tagName = heading.tagName;
      var indent = tagName[1];
      var div = $("<li />");
      var font_size_adjustment = (70) + (50 / indent);
      var a = $("<a />")
        .attr('href', '#' + hId)
        .addClass("content-link")
        .css('margin-left', indent * 8)
        .css('font-size', font_size_adjustment + "%")
        .css('margin-top', '4px')
        .html($(heading).html());

      div.append(a);
      contents.append(div);


      $(heading).append($("<div />").attr("id", hId));

    });

    $el = this.$el;
    $el.find(".toc").append(contents);
    setTimeout(function() {
      var $spy = $("body").scrollspy({target: "#" + $el.attr("id")});
    }, 100);
  },
  render: function() {
    this.$el.find(".toc").empty();
    this.$el.find(".toc").append("Generating contents...");

  }
};

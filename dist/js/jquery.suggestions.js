/**
 * DaData.ru Suggestions jQuery plugin, version 4.4.1
 *
 * DaData.ru Suggestions jQuery plugin is freely distributable under the terms of MIT-style license
 * Built on DevBridge Autocomplete for jQuery (https://github.com/devbridge/jQuery-Autocomplete)
 * For details, see https://github.com/hflabs/suggestions-jquery
 */
// Expose plugin as an AMD module if AMD loader is present:
(function (factory) {
    'use strict';
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['jquery'], factory);
    } else {
        // Browser globals
        factory(jQuery);
    }
}(function ($) {
    'use strict';

    var
        utils = (function () {
            var uniqueId = 0;
            return {
                escapeRegExChars: function (value) {
                    return value.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
                },
                getDefaultType: function () {
                    return ($.support.cors ? 'POST' : 'GET');
                },
                getDefaultContentType: function () {
                    return ($.support.cors ? 'application/json' : 'application/x-www-form-urlencoded');
                },
                serialize: function (data) {
                    if ($.support.cors) {
                        return JSON.stringify(data);
                    } else {
                        return $.param(data, true);
                    }
                },
                compact: function (array) {
                    return $.grep(array, function (el) {
                        return !!el;
                    });
                },
                uniqueId: function () {
                    return ++uniqueId;
                }
            };
        }()),

        keys = {
            ESC: 27,
            TAB: 9,
            RETURN: 13,
            SPACE: 32,
            LEFT: 37,
            UP: 38,
            RIGHT: 39,
            DOWN: 40
        },
        types = ['NAME', 'ADDRESS'],

        eventNS = '.suggestions',
        dataAttrKey = 'suggestions',
        dadataConfig = {
            url: 'https://dadata.ru/api/v1/clean',
            timeout: 1000
        },
        tokensValid = {},
        enrichServices = {};

    enrichServices['default'] = {
        enrichSuggestion: function (suggestion) {
            return $.Deferred().resolve(suggestion);
        },
        enrichResponse: function (response, query) {
            return $.Deferred().resolve(response);
        }
    };

    enrichServices['dadata'] = (function () {
        var fieldParsers = {};

        /**
         * Values of `gender` from dadata.ru differ from ones in original suggestions
         * @param value
         * @returns {{gender: string}}
         */
        fieldParsers.gender = function (value) {
            return {
                gender: value == 'М' ? 'MALE' :
                    value == 'Ж' ? 'FEMALE' : 'UNKNOWN'
            }
        };

        /**
         * Each of these fields in dadata's answer combines two fields of standard suggestion object
         */
        $.each(['region', 'area', 'city', 'settlement', 'street'], function (i, field) {
            function typeGoesFirst(addressPart) {
                if (field === 'city' || field === 'settlement' || field === 'street') {
                    return true;
                } else {
                    var typeRE = /^(г|Респ|тер|у)/i;
                    return typeRE.test(addressPart);
                }
            }

            fieldParsers[field] = function (value) {
                var addressPartType,
                    addressPartValue,
                    result = {};
                if (value) {
                    var addressParts = value.split(' ');
                    if (typeGoesFirst(value)) {
                        addressPartType = addressParts.shift();
                    } else {
                        addressPartType = addressParts.pop();
                    }
                    addressPartValue = addressParts.join(' ');
                } else {
                    addressPartType = null;
                    addressPartValue = value;
                }
                result[field + '_type'] = addressPartType;
                result[field] = addressPartValue;
                return result;
            };
        });

        var valueComposer = {
            'NAME': function (data) {
                return utils.compact([data.surname, data.name, data.patronymic]).join(' ');
            },
            'ADDRESS': function (data) {
                return utils.compact([data.country, data.region, data.area, data.city, data.settlement, data.street,
                    utils.compact([data.house_type, data.house]).join(' '),
                    utils.compact([data.block_type, data.block]).join(' '),
                    utils.compact([data.flat_type, data.flat]).join(' ')
                ]).join(', ');
            }
        };

        function startRequest(query) {
            var that = this,
                token = $.trim(that.options.token),
                data = {
                    structure: [that.options.type],
                    data: [
                        [ query ]
                    ]
                };

            that.currentRequest = $.ajax(dadataConfig.url, {
                type: 'POST',
                headers: {
                    'Authorization': 'Token ' + token
                },
                contentType: 'application/json',
                dataType: 'json',
                data: JSON.stringify(data),
                timeout: dadataConfig.timeout
            });
            return that.currentRequest;
        }

        return {
            enrichSuggestion: function (suggestion) {
                var that = this,
                    resolver = $.Deferred();

                // if current suggestion is from dadata, use it
                if (suggestion.data && 'qc' in suggestion.data) {
                    return resolver.resolve(suggestion);
                }

                that.showPreloader();
                that.disableDropdown();
                startRequest.call(that, suggestion.value)
                    .always(function () {
                        that.hidePreloader();
                        that.enableDropdown();
                        that.currentRequest = null;
                    })
                    .done(function (resp) {
                        var data = resp.data,
                            s = data && data[0] && data[0][0];

                        if (s && s.qc === 0) {
                            if (!suggestion.data) {
                                suggestion.data = {};
                            }
                            delete s.source;
                            $.each(s, function (field, value) {
                                if (!(field in suggestion.data)) {
                                    var parser = fieldParsers[field];
                                    if (parser) {
                                        $.extend(suggestion.data, parser(value))
                                    } else {
                                        suggestion.data[field] = value;
                                    }
                                }
                            });
                        }
                        resolver.resolve(suggestion);
                    })
                    .fail(function () {
                        resolver.resolve(suggestion);
                    });
                return resolver;
            },
            enrichResponse: function (response, query) {
                var that = this,
                    suggestions = response.suggestions || [],
                    resolver = $.Deferred();

                if (suggestions.length) {
                    return resolver.resolve(response);
                }

                startRequest.call(that, query)
                    .always(function () {
                        that.currentRequest = null;
                    })
                    .done(function (resp) {
                        var data = resp.data,
                            value;
                        data = data && data[0] && data[0][0];
                        if (data) {
                            delete data.source;
                            value = valueComposer[that.options.type](data);
                            if (value) {
                                $.each(fieldParsers, function (field, parser) {
                                    if (field in data) {
                                        $.extend(data, parser(data[field]));
                                    }
                                });
                                response.suggestions = [
                                    {
                                        value: value,
                                        data: data
                                    }
                                ];
                            }
                        }
                        resolver.resolve(response);
                    })
                    .fail(function () {
                        resolver.resolve(response);
                    });
                return resolver;
            }
        }
    })();

    function Suggestions(el, options) {
        var that = this,
            defaults = {
                autoSelectFirst: false,
                serviceUrl: null,
                lookup: null,
                onSelect: null,
                width: 'auto',
                minChars: 1,
                maxHeight: 300,
                deferRequestBy: 0,
                params: {},
                formatResult: Suggestions.formatResult,
                delimiter: null,
                zIndex: 9999,
                noCache: false,
                onSearchStart: $.noop,
                onSearchComplete: $.noop,
                onSearchError: $.noop,
                containerClass: 'suggestions-suggestions',
                tabDisabled: false,
                currentRequest: null,
                triggerSelectOnValidInput: false,
                triggerSelectOnSpace: true,
                preventBadQueries: false,
                lookupFilter: function (suggestion, originalQuery, queryLowerCase) {
                    return suggestion.value.toLowerCase().indexOf(queryLowerCase) !== -1;
                },
                paramName: 'query',
                transformResult: function (response) {
                    return typeof response === 'string' ? $.parseJSON(response) : response;
                },
                usePreloader: true,
                hint: Suggestions.defaultHint,
                useDadata: true,
                type: null,
                count: Suggestions.defaultCount,
                constraints: null
            };

        // Shared variables:
        that.element = el;
        that.el = $(el);
        that.suggestions = [];
        that.badQueries = [];
        that.selectedIndex = -1;
        that.currentValue = that.element.value;
        that.intervalId = 0;
        that.cachedResponse = {};
        that.onChangeInterval = null;
        that.onChange = null;
        that.isLocal = false;
        that.suggestionsContainer = null;
        that.$wrapper = null;
        that.$preloader = null;
        that.$constraints = null;
        that.options = $.extend({}, defaults, options);
        that.classes = {
            hint: 'suggestions-hint',
            selected: 'suggestions-selected',
            suggestion: 'suggestions-suggestion'
        };
        that.hint = null;
        that.hintValue = '';
        that.selection = null;
        that.$viewport = $(window);
        that.triggeredSelectOnSpace = false;
        that.triggeringSelectOnSpace = false;
        that.skipOnFocus = false;
        that.enrichService = enrichServices.default;
        that.dropdownDisabled = false;
        that.expectedComponents = [];
        that.constraints = {};
        that.initialPaddingLeft = 0;
        that.uniqueId = utils.uniqueId();

        // Initialize and set options:
        that.initialize();
        that.setOptions(options);
    }

    Suggestions.utils = utils;

    Suggestions.formatResult = function (suggestion, currentValue) {
        var pattern = '(^|\\s+)(' + utils.escapeRegExChars(currentValue) + ')';
        return suggestion.value.replace(new RegExp(pattern, 'gi'), '$1<strong>$2<\/strong>');
    };

    Suggestions.resetTokens = function () {
        tokensValid = {};
    };

    Suggestions.defaultHint = 'Выберите вариант ниже или продолжите ввод';

    Suggestions.dadataConfig = dadataConfig;

    Suggestions.defaultCount = 10;

    $.Suggestions = Suggestions;

    Suggestions.prototype = {

        initialize: function () {
            var that = this,
                suggestionSelector = '.' + that.classes.suggestion,
                selected = that.classes.selected,
                options = that.options,
                $container;

            // Remove autocomplete attribute to prevent native suggestions:
            that.element.setAttribute('autocomplete', 'off');
            that.initialPaddingLeft = parseFloat(that.el.css('padding-left'))||0;

            that.$wrapper = $('<div class="suggestions-wrapper"/>');
            that.el.after(that.$wrapper);

            that.$preloader = $('<i class="suggestions-preloader"/>');
            that.$wrapper.append(that.$preloader);

            that.$constraints = $('<ul class="suggestions-constraints"/>');
            that.$wrapper.append(that.$constraints);
            that.$constraints.on('click', '.suggestions-remove', function (e) {
                var $item = $(e.target).closest('li'),
                    key = $item.attr('data-key');
                $item.fadeOut('fast', function () {
                    that.removeConstraint(key);
                });
            });

            that.killerFn = function (e) {
                if ($(e.target).closest('.' + that.options.containerClass).length === 0) {
                    that.killSuggestions();
                    that.disableKillerFn();
                }
            };

            $container = $('<div/>')
                .addClass(options.containerClass)
                .css({
                    position: 'absolute',
                    display: 'none'
                });
            that.$container = $container;
            that.suggestionsContainer = $container[0];
            that.$wrapper.append($container);

            // Only set width if it was provided:
            if (options.width !== 'auto') {
                $container.width(options.width);
            }

            // This whole handler is needed to prevent blur event on textbox
            // when suggestion is clicked (blur leads to suggestions hide, so we need to prevent it).
            // See https://github.com/jquery/jquery-ui/blob/master/ui/autocomplete.js for details
            $container.on('mousedown' + eventNS, suggestionSelector, function (event) {
                // prevent moving focus out of the text field
                event.preventDefault();

                // IE doesn't prevent moving focus even with event.preventDefault()
                // so we set a flag to know when we should ignore the blur event
                that.cancelBlur = true;
                that._delay(function () {
                    delete that.cancelBlur;
                });

                // clicking on the scrollbar causes focus to shift to the body
                // but we can't detect a mouseup or a click immediately afterward
                // so we have to track the next mousedown and close the menu if
                // the user clicks somewhere outside of the autocomplete
                if (!$(event.target).closest(".ui-menu-item").length) {
                    that._delay(function () {
                        $(document).one("mousedown", function (event) {
                            if (event.target !== that.element &&
                                event.target !== that.suggestionsContainer && !$.contains(that.suggestionsContainer, event.target)) {
                                that.hide();
                            }
                        });
                    });
                }
            });

            // Listen for mouse over event on suggestions list:
            $container.on('mouseover' + eventNS, suggestionSelector, function () {
                that.activate($(this).data('index'));
            });

            // Deselect active element when mouse leaves suggestions container:
            $container.on('mouseout' + eventNS, function () {
                if (!that.dropdownDisabled) {
                    that.selectedIndex = -1;
                    $container.children('.' + selected).removeClass(selected);
                }
            });

            // Listen for click event on suggestions list:
            $container.on('click' + eventNS, suggestionSelector, function () {
                if (!that.dropdownDisabled) {
                    that.select($(this).data('index'));
                }
                that.skipOnFocus = true;
                that.el.focus();
            });

            that.fixPosition();

            that.$viewport.on('resize' + eventNS + that.uniqueId, $.proxy(that.fixPosition, that));

            that.el.on('keydown' + eventNS, function (e) {
                that.onKeyPress(e);
            });
            that.el.on('keyup' + eventNS, function (e) {
                that.onKeyUp(e);
            });
            that.el.on('blur' + eventNS, function () {
                that.onBlur();
            });
            that.el.on('focus' + eventNS, function () {
                that.onFocus();
            });
            that.el.on('change' + eventNS, function (e) {
                that.onKeyUp(e);
            });
        },

        onFocus: function () {
            var that = this;
            if (!that.skipOnFocus) {
                that.fixPosition();
                if (that.options.minChars <= that.el.val().length) {
                    that.onValueChange();
                }
            }
            that.skipOnFocus = false;
        },

        onBlur: function () {
            var that = this;
            // suggestion was clicked, blur should be ignored
            // see container mousedown handler
            if (that.cancelBlur) {
                delete that.cancelBlur;
                return;
            }
            that.selectCurrentValue();
            that.hide();
        },

        setOptions: function (suppliedOptions) {
            var that = this,
                options = that.options;

            $.extend(options, suppliedOptions);

            that.isLocal = $.isArray(options.lookup);

            if (that.isLocal) {
                options.lookup = that.verifySuggestionsFormat(options.lookup);
            }

            // Adjust height, width and z-index:
            var styles = {
                'max-height': options.maxHeight + 'px',
                'z-index': options.zIndex
            };
            if (options.width !== 'auto') {
                styles['width'] = options.width + 'px';
            }
            that.$container.css(styles);

            that.checkToken();
            that.selectEnrichService();
            that.selectExpectedComponents();
            that.setupConstraints();
        },

        getAjaxParams: function () {
            var that = this,
                params,
                token = $.trim(that.options.token);

            params = {
                type: utils.getDefaultType(),
                dataType: 'json',
                contentType: utils.getDefaultContentType()
            };
            if (token) {
                params.headers = {
                    'Authorization': 'Token ' + token
                }
            }
            return params;
        },

        checkToken: function () {
            var that = this,
                token = $.trim(that.options.token),
                tokenValid = tokensValid[token],
                onTokenReady = function () {
                    that.checkToken();
                },
                serviceUrl;

            if (token) {
                if (tokenValid && $.isFunction(tokenValid.promise)) {
                    switch (tokenValid.state()) {
                        case 'resolved':
                            that.enable();
                            break;
                        case 'rejected':
                            that.disable();
                            break;
                        default:
                            tokenValid.always(onTokenReady);
                    }
                } else {
                    serviceUrl = that.options.serviceUrl;
                    if ($.isFunction(serviceUrl)) {
                        serviceUrl = serviceUrl.call(that.element);
                    }
                    tokensValid[token] = $.ajax(
                        $.extend(that.getAjaxParams(), {
                            url: serviceUrl
                        })
                    ).always(onTokenReady);
                }
            }
        },

        selectEnrichService: function () {
            var that = this,
                type = that.options.type,
                token = $.trim(that.options.token);
            if (that.options.useDadata && type && types.indexOf(type) >= 0 && token) {
                that.enrichService = enrichServices.dadata;
            } else {
                that.enrichService = enrichServices.default;
            }
        },

        selectExpectedComponents: function () {
            var that = this,
                type = that.options.type,
                params = that.options.params;
            switch (type) {
                case 'NAME':
                    that.expectedComponents = $.map(params && params.parts || ['surname', 'name', 'patronymic'], function (part) {
                        return part.toLowerCase();
                    });
                    break;
                case 'ADDRESS':
                    that.expectedComponents = ['house'];
                    break;
                default:
                    that.expectedComponents = [];
            }
        },

        clearCache: function () {
            this.cachedResponse = {};
            this.badQueries = [];
        },

        clear: function () {
            this.clearCache();
            this.currentValue = '';
            this.suggestions = [];
        },

        disable: function () {
            var that = this;
            that.disabled = true;
            if (that.currentRequest) {
                that.currentRequest.abort();
            }
        },

        enable: function () {
            this.disabled = false;
        },

        fixPosition: function () {
            var that = this,
                borderTop = that.el.css('border-top-style') == 'none' ? 0 : parseFloat(that.el.css('border-top-width')),
                borderLeft = that.el.css('border-left-style') == 'none' ? 0 : parseFloat(that.el.css('border-left-width')),
                elOffset = that.el.offset(),
                elInnerHeight,
                wrapperOffset = that.$wrapper.offset(),
                origin = {
                    top: elOffset.top - wrapperOffset.top,
                    left: elOffset.left - wrapperOffset.left
                };

            elInnerHeight = that.el.innerHeight();

            that.$container.css({
                left: origin.left + 'px',
                top: origin.top + borderTop + elInnerHeight + 'px',
                width: (that.options.width === 'auto' ? that.el.outerWidth() : that.options.width) + 'px'
            });

            that.$preloader.css({
                left: origin.left + borderLeft + that.el.innerWidth() - that.$preloader.width() - 4 + 'px',
                top: origin.top + Math.round((elInnerHeight - that.$preloader.height()) / 2) + 'px'
            });

            that.$constraints.css({
                left: origin.left + that.initialPaddingLeft + 'px',
                top: origin.top + Math.round((elInnerHeight - that.$constraints.height()) / 2) + 'px'
            });

            that.el.css({
                'paddingLeft': that.initialPaddingLeft + that.$constraints.outerWidth(true) + 'px'
            });

        },

        isCursorAtEnd: function () {
            var that = this,
                valLength = that.el.val().length,
                selectionStart = that.element.selectionStart,
                range;

            if (typeof selectionStart === 'number') {
                return selectionStart === valLength;
            }
            if (document.selection) {
                range = document.selection.createRange();
                range.moveStart('character', -valLength);
                return valLength === range.text.length;
            }
            return true;
        },

        onKeyPress: function (e) {
            var that = this,
                index;

            that.triggeredSelectOnSpace = false;
            that.triggeringSelectOnSpace = false;

            // If suggestions are hidden and user presses arrow down, display suggestions:
            if (!that.disabled && !that.visible && e.which === keys.DOWN && that.currentValue) {
                that.suggest();
                return;
            }

            if (that.disabled || !that.visible) {
                return;
            }

            switch (e.which) {
                case keys.ESC:
                    that.el.val(that.currentValue);
                    that.hide();
                    break;
                case keys.RIGHT:
                    if (that.hint && that.options.onHint && that.isCursorAtEnd()) {
                        that.selectHint();
                        break;
                    }
                    return;
                case keys.TAB:
                    if (that.hint && that.options.onHint) {
                        that.selectHint();
                        return;
                    }
                    if (that.selectedIndex === -1) {
                        that.hide();
                        return;
                    }
                    that.select(that.selectedIndex);
                    if (that.options.tabDisabled === false) {
                        return;
                    }
                    break;

                case keys.RETURN:
                    index = that.selectCurrentValue();
                    if (index === -1) {
                        that.hide();
                        return;
                    }
                    break;
                case keys.SPACE:
                    if (that.options.triggerSelectOnSpace && that.isCursorAtEnd()) {
                        that.triggeringSelectOnSpace = true;
                        index = that.selectCurrentValue(true);
                        if (index !== -1) {
                            that.triggeredSelectOnSpace = true;
                        }
                    }
                    return;
                case keys.UP:
                    that.moveUp();
                    break;
                case keys.DOWN:
                    that.moveDown();
                    break;
                default:
                    return;
            }

            // Cancel event if function did not return:
            e.stopImmediatePropagation();
            e.preventDefault();
        },

        onKeyUp: function (e) {
            var that = this;

            if (that.disabled) {
                return;
            }

            switch (e.which) {
                case keys.UP:
                case keys.DOWN:
                    return;
            }

            clearInterval(that.onChangeInterval);

            if (that.currentValue !== that.el.val()) {
                that.findBestHint();
                if (that.options.deferRequestBy > 0) {
                    // Defer lookup in case when value changes very quickly:
                    that.onChangeInterval = setInterval(function () {
                        that.onValueChange();
                    }, that.options.deferRequestBy);
                } else {
                    that.onValueChange();
                }
            }
        },

        onValueChange: function () {
            var that = this,
                options = that.options,
                value = that.el.val(),
                query = that.getQuery(value),
                index;

            if (that.selection) {
                that.selection = null;
                (options.onInvalidateSelection || $.noop).call(that.element);
            }

            clearInterval(that.onChangeInterval);
            that.currentValue = value;
            that.selectedIndex = -1;

            // Check existing suggestion for the match before proceeding:
            if (options.triggerSelectOnValidInput) {
                index = that.findSuggestionIndex(query);
                if (index !== -1) {
                    that.select(index);
                    return;
                }
            }

            if (query.length < options.minChars) {
                that.hide();
            } else {
                that.getSuggestions(query);
            }
        },

        findSuggestionIndex: function (query) {
            var that = this,
                index = -1,
                queryLowerCase = query.toLowerCase();

            $.each(that.suggestions, function (i, suggestion) {
                if (suggestion.value.toLowerCase() === queryLowerCase) {
                    index = i;
                    return false;
                }
            });

            return index;
        },

        getQuery: function (value) {
            var delimiter = this.options.delimiter,
                parts;

            if (!delimiter) {
                return value;
            }
            parts = value.split(delimiter);
            return $.trim(parts[parts.length - 1]);
        },

        getSuggestionsLocal: function (query) {
            var that = this,
                options = that.options,
                queryLowerCase = query.toLowerCase(),
                filter = options.lookupFilter,
                limit = parseInt(options.lookupLimit, 10),
                data;

            data = {
                suggestions: $.grep(options.lookup, function (suggestion) {
                    return filter(suggestion, query, queryLowerCase);
                })
            };

            if (limit && data.suggestions.length > limit) {
                data.suggestions = data.suggestions.slice(0, limit);
            }

            return data;
        },

        getSuggestions: function (q) {
            var response,
                that = this,
                options = that.options,
                serviceUrl = options.serviceUrl,
                params = null,
                cacheKey;

            if (!options.ignoreParams) {
                params = $.extend({}, options.params);
                params[options.paramName] = q;
                if ($.isNumeric(options.count) && options.count > 0) {
                    params.count = options.count;
                }
            }

            if (that.isLocal) {
                response = that.getSuggestionsLocal(q);
            } else {
                if ($.isFunction(serviceUrl)) {
                    serviceUrl = serviceUrl.call(that.element, q);
                }
                cacheKey = serviceUrl + '?' + $.param(params || {});
                response = that.cachedResponse[cacheKey];
            }

            if (response && $.isArray(response.suggestions)) {
                that.suggestions = response.suggestions;
                that.suggest();
            } else if (!that.isBadQuery(q)) {
                if (options.onSearchStart.call(that.element, options.params) === false) {
                    return;
                }
                if (that.currentRequest) {
                    that.currentRequest.abort();
                }
                that.showPreloader();
                that.currentRequest = $.ajax(
                        $.extend(that.getAjaxParams(), {
                            url: serviceUrl,
                            data: utils.serialize(params)
                        })
                    ).done(function (data) {
                        var result;
                        that.currentRequest = null;
                        result = options.transformResult(data);
                        that.enrichService.enrichResponse.call(that, result, q)
                            .done(function (enrichedResponse) {
                                that.processResponse(enrichedResponse, q, cacheKey);
                                options.onSearchComplete.call(that.element, q, enrichedResponse.suggestions);
                                that.hidePreloader();
                            })
                    }).fail(function (jqXHR, textStatus, errorThrown) {
                        options.onSearchError.call(that.element, q, jqXHR, textStatus, errorThrown);
                        that.hidePreloader();
                    });
            }
        },

        isBadQuery: function (q) {
            if (!this.options.preventBadQueries) {
                return false;
            }

            var badQueries = this.badQueries,
                i = badQueries.length;

            while (i--) {
                if (q.indexOf(badQueries[i]) === 0) {
                    return true;
                }
            }

            return false;
        },

        hide: function () {
            var that = this;
            that.visible = false;
            that.selectedIndex = -1;
            that.$container.hide().empty();
            that.signalHint(null);
        },

        suggest: function () {
            if (this.suggestions.length === 0) {
                this.hide();
                return;
            }

            var that = this,
                options = that.options,
                formatResult = options.formatResult,
                value = that.getQuery(that.currentValue),
                className = that.classes.suggestion,
                classSelected = that.classes.selected,
                beforeRender = options.beforeRender,
                $container = that.$container,
                html = [],
                index;

            if (options.triggerSelectOnValidInput) {
                index = that.findSuggestionIndex(value);
                if (index !== -1) {
                    that.select(index);
                    return;
                }
            }

            if (options.triggerSelectOnSpace && !that.triggeredSelectOnSpace && /\s$/.test(value)) {
                index = that.findSuggestionIndex(value.replace(/\s$/, ''));
                if (index !== -1) {
                    that.onSelect(index);
                }
            }

            // Build hint html
            if (options.hint && that.suggestions.length) {
                html.push('<div class="' + that.classes.hint + '">' + options.hint + '</div>');
            }
            // Build suggestions inner HTML:
            $.each(that.suggestions, function (i, suggestion) {
                html.push('<div class="' + className + '" data-index="' + i + '">' + formatResult(suggestion, value) + '</div>');
            });

            $container.html(html.join(''));

            // Select first value by default:
            if (options.autoSelectFirst) {
                that.selectedIndex = 0;
                $container.children().first().addClass(classSelected);
            }

            if ($.isFunction(beforeRender)) {
                beforeRender.call(that.element, $container);
            }

            $container.show();
            that.visible = true;

            that.findBestHint();
        },

        showPreloader: function () {
            if (this.options.usePreloader) {
                this.$preloader
                    .stop(true)
                    .delay(50)
                    .animate({'opacity': 1}, 'fast');
            }
        },

        hidePreloader: function () {
            if (this.options.usePreloader) {
                this.$preloader
                    .stop(true)
                    .animate({'opacity': 0}, 'fast');
            }
        },

        findBestHint: function () {
            var that = this,
                value = that.el.val().toLowerCase(),
                bestMatch = null;

            if (!value) {
                return;
            }

            $.each(that.suggestions, function (i, suggestion) {
                var foundMatch = suggestion.value.toLowerCase().indexOf(value) === 0;
                if (foundMatch) {
                    bestMatch = suggestion;
                }
                return !foundMatch;
            });

            that.signalHint(bestMatch);
        },

        signalHint: function (suggestion) {
            var hintValue = '',
                that = this;
            if (suggestion) {
                hintValue = that.currentValue + suggestion.value.substr(that.currentValue.length);
            }
            if (that.hintValue !== hintValue) {
                that.hintValue = hintValue;
                that.hint = suggestion;
                (this.options.onHint || $.noop)(hintValue);
            }
        },

        verifySuggestionsFormat: function (suggestions) {
            // If suggestions is string array, convert them to supported format:
            if (suggestions.length && typeof suggestions[0] === 'string') {
                return $.map(suggestions, function (value) {
                    return { value: value, data: null };
                });
            }

            return suggestions;
        },

        processResponse: function (result, originalQuery, cacheKey) {
            var that = this,
                options = that.options;

            result.suggestions = that.verifySuggestionsFormat(result.suggestions);

            // Cache results if cache is not disabled:
            if (!options.noCache) {
                that.cachedResponse[cacheKey] = result;
                if (options.preventBadQueries && result.suggestions.length === 0) {
                    that.badQueries.push(originalQuery);
                }
            }

            // Return if originalQuery is not matching current query:
            if (originalQuery !== that.getQuery(that.currentValue)) {
                return;
            }

            that.suggestions = result.suggestions;
            that.suggest();
        },

        activate: function (index) {
            var that = this,
                activeItem,
                selected = that.classes.selected,
                children;

            if (!that.dropdownDisabled) {
                children = that.$container.children('.' + that.classes.suggestion);

                children.filter('.' + selected).removeClass(selected);

                that.selectedIndex = index;

                if (that.selectedIndex !== -1 && children.length > that.selectedIndex) {
                    activeItem = children.get(that.selectedIndex);
                    $(activeItem).addClass(selected);
                    return activeItem;
                }
            }

            return null;
        },

        enableDropdown: function () {
            var that = this;
            that.dropdownDisabled = false;
            that.$container.attr('disabled', false);
        },

        disableDropdown: function () {
            var that = this;
            that.dropdownDisabled = true;
            that.$container.attr('disabled', true);
        },

        selectHint: function () {
            var that = this,
                i = $.inArray(that.hint, that.suggestions);

            that.select(i);
        },

        selectCurrentValue: function (noHide) {
            var that = this,
                index = that.selectedIndex;
            if (index === -1) {
                var value = that.getQuery(that.el.val());
                index = that.findSuggestionIndex(value);
            }
            if (index !== -1) {
                that.select(index, noHide);
            }
            return index;
        },

        select: function (index, noHide) {
            var that = this,
                suggestion = that.suggestions[index],
                valueSuffix = that.hasExpectedComponents(suggestion) || that.triggeringSelectOnSpace ? '' : ' ';

            that.currentValue = that.getValue(suggestion.value);
            that.el.val(that.currentValue + valueSuffix);
            that.signalHint(null);
            that.selection = suggestion;

            that.onSelect(index)
                .done(function () {
                    if (!noHide) {
                        that.hide();
                    }
                });

            that.suggestions = [];
        },

        unselect: function () {
            var that = this;

            that.$container.children().removeClass(that.classes.selected);
            that.selectedIndex = -1;
            that.el.val(that.currentValue);
            that.findBestHint();
        },

        hasExpectedComponents: function (suggestion) {
            var that = this,
                result = true;
            $.each(that.expectedComponents, function (i, part) {
                return result = result && !!suggestion.data[part];
            });
            return result;
        },

        moveUp: function () {
            var that = this;

            if (that.dropdownDisabled) {
                return;
            }
            if (that.selectedIndex === -1) {
                if (that.suggestions.length) {
                    that.adjustScroll(that.suggestions.length - 1);
                }
                return;
            }

            if (that.selectedIndex === 0) {
                that.unselect();
                return;
            }

            that.adjustScroll(that.selectedIndex - 1);
        },

        moveDown: function () {
            var that = this;

            if (that.dropdownDisabled) {
                return;
            }
            if (that.selectedIndex === (that.suggestions.length - 1)) {
                that.unselect();
                return;
            }

            that.adjustScroll(that.selectedIndex + 1);
        },

        adjustScroll: function (index) {
            var that = this,
                activeItem = that.activate(index),
                offsetTop,
                upperBound,
                lowerBound,
                heightDelta = 25;

            if (!activeItem) {
                return;
            }

            offsetTop = activeItem.offsetTop;
            upperBound = that.$container.scrollTop();
            lowerBound = upperBound + that.options.maxHeight - heightDelta;

            if (offsetTop < upperBound) {
                that.$container.scrollTop(offsetTop);
            } else if (offsetTop > lowerBound) {
                that.$container.scrollTop(offsetTop - that.options.maxHeight + heightDelta);
            }

            that.el.val(that.getValue(that.suggestions[index].value));
            that.signalHint(null);
        },

        /**
         * Provides a suggetion outside of the instance
         * Returns $.Deferred, which will be resolved after enrichService proceeded
         */
        onSelect: function (index) {
            var that = this,
                onSelectCallback = that.options.onSelect,
                suggestion = that.suggestions[index],
                selectionCompleter = $.Deferred();

            if ($.isFunction(onSelectCallback)) {
                that.enrichService.enrichSuggestion.call(that, suggestion)
                    .done(function (enrichedSuggestion) {
                        onSelectCallback.call(that.element, enrichedSuggestion),
                            selectionCompleter.resolve();
                    });
            } else {
                selectionCompleter.resolve();
            }
            return selectionCompleter;
        },

        getValue: function (value) {
            var that = this,
                delimiter = that.options.delimiter,
                currentValue,
                parts;

            if (!delimiter) {
                return value;
            }

            currentValue = that.currentValue;
            parts = currentValue.split(delimiter);

            if (parts.length === 1) {
                return value;
            }

            return currentValue.substr(0, currentValue.length - parts[parts.length - 1].length) + value;
        },

        getConstraintItem: function (key) {
            return this.$constraints.children('[data-key="' + key + '"]');
        },

        addConstraint: function (key, value) {
            var that = this,
                $item = that.getConstraintItem(key);

            that.constraints[key] = value;
            if (!$item.length) {
                $item = $('<li><span/> <span class="suggestions-remove"/></li>').attr('data-key', key);
                that.$constraints.append($item);
            }
            $item.children().first().text(value);
            that.fixPosition();
        },

        removeConstraint: function (key) {
            var that = this;
            delete that.constraints[key];
            that.getConstraintItem(key).remove();
            that.fixPosition();
        },

        setupConstraints: function () {
            var that = this,
                constraints = that.options.constraints;

            if (!constraints) {
                return;
            }
            $.each(that.constraints, function (key) {
                if (!(key in constraints)) {
                    that.removeConstraint(key);
                }
            });
            $.each(constraints, $.proxy(that.addConstraint, that));
        },

        dispose: function () {
            var that = this;
            that.el.off(eventNS + that.uniqueId).removeData(dataAttrKey);
            that.$viewport.off('resize' + eventNS);
            that.$wrapper.remove();
        },

        _delay: function (handler, delay) {
            function handlerProxy() {
                return ( typeof handler === "string" ? instance[ handler ] : handler )
                    .apply(instance, arguments);
            }

            var instance = this;
            return setTimeout(handlerProxy, delay || 0);
        }
    };

    // Create chainable jQuery plugin:
    $.fn.suggestions = function (options, args) {
        // If function invoked without argument return
        // instance of the first matched element:
        if (arguments.length === 0) {
            return this.first().data(dataAttrKey);
        }

        return this.each(function () {
            var inputElement = $(this),
                instance = inputElement.data(dataAttrKey);

            if (typeof options === 'string') {
                if (instance && typeof instance[options] === 'function') {
                    instance[options](args);
                }
            } else {
                // If instance already exists, destroy it:
                if (instance && instance.dispose) {
                    instance.dispose();
                }
                instance = new Suggestions(this, options);
                inputElement.data(dataAttrKey, instance);
            }
        });
    };
}));
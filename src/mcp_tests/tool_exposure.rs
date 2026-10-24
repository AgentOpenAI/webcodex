use super::*;
use crate::mcp::request_policy::McpSurface;
use crate::mcp::tool_exposure::{ToolExposure, ToolExposureConfig};

fn configured(config: ToolExposureConfig) -> ToolRuntime {
    let mut runtime = test_runtime();
    Arc::make_mut(&mut runtime.runtime_info).mcp_tool_exposure = config;
    runtime
}

fn oauth(client: &str) -> AuthContext {
    let mut auth = crate::auth::shared_key_context("exposure-test");
    auth.kind = crate::auth::AuthKind::OAuth2Token;
    auth.allowed_client_id = Some(client.to_string());
    auth.scopes.push(crate::auth::SCOPE_ADMIN.to_string());
    auth
}

async fn request(
    runtime: &ToolRuntime,
    surface: McpSurface,
    auth: Option<&AuthContext>,
    method: &str,
    params: Value,
    compact: bool,
    apps: bool,
) -> McpOutcome {
    handle_mcp_request_for_surface(
        runtime,
        rpc(method, Some(json!(1)), mcp_2026_ui_params(params)),
        auth,
        McpProtocolEra::Stateless2026,
        HostFileImportTrust::Untrusted,
        None,
        None,
        None,
        compact,
        apps,
        None,
        surface,
        None,
    )
    .await
}

fn result(outcome: McpOutcome) -> Value {
    let McpOutcome::Ok(body) = outcome else {
        panic!("{outcome:?}");
    };
    body["result"].clone()
}

fn model_names(payload: &Value) -> Vec<String> {
    payload["tools"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|tool| tool.pointer("/_meta/ui/visibility") != Some(&json!(["app"])))
        .map(|tool| tool["name"].as_str().unwrap().to_string())
        .collect()
}

#[test]
fn config_is_closed_bounded_private_and_client_selection_is_authenticated() {
    for invalid in [
        "",
        "[]",
        r#"{"adaptive":{"goals":"true"}}"#,
        r#"{"private-input":true}"#,
        r#"{"adaptive":{"goals":true,"goals":false}}"#,
        r#"{"oauth_clients":[{"client_id":"a"}]}"#,
        r#"{"oauth_clients":[{"client_id":"a","adaptive":{}},{"client_id":"a","cli":{}}]}"#,
        r#"{"oauth_clients":[{"client_id":" a","adaptive":{}}]}"#,
    ] {
        let err = ToolExposureConfig::parse(invalid).unwrap_err();
        assert!(!err.contains("private-input"));
    }
    assert!(ToolExposureConfig::parse(&" ".repeat(16 * 1024 + 1)).is_err());
    let many = json!({"oauth_clients": (0..65).map(|n| json!({"client_id":format!("c{n}"),"adaptive":{}})).collect::<Vec<_>>()});
    assert!(ToolExposureConfig::parse(&many.to_string()).is_err());
    let long = json!({"oauth_clients":[{"client_id":"x".repeat(257),"cli":{}}]});
    assert!(ToolExposureConfig::parse(&long.to_string()).is_err());
    let config = ToolExposureConfig::parse(
        r#"{
        "adaptive":{"goals":true},
        "cli":{"job_continuation":true},
        "oauth_clients":[{"client_id":"online-client","adaptive":{"agent_continuation":true}}]
    }"#,
    )
    .unwrap();
    let auth = oauth("online-client");
    assert_eq!(
        config.resolve(McpSurface::Adaptive, Some(&auth)),
        ToolExposure {
            agent_continuation: true,
            ..Default::default()
        }
    );
    assert!(
        config
            .resolve(McpSurface::Cli, Some(&auth))
            .job_continuation
    );
    assert!(
        config
            .resolve(McpSurface::Adaptive, Some(&oauth("other")))
            .goals
    );
    let mut forged = auth.clone();
    forged.kind = crate::auth::AuthKind::ApiToken;
    assert!(config.resolve(McpSurface::Adaptive, Some(&forged)).goals);
    assert!(!config.status().to_string().contains("online-client"));
    assert!(!format!("{config:?}").contains("online-client"));
    let schema = crate::tool_runtime::registry::output_schema_for_tool("get_runtime_status");
    let schema = &schema["properties"]["output"]["properties"]["effective_config"]["properties"]
        ["mcp_tool_exposure"];
    crate::tool_runtime::startup_brief::validate_schema_instance_for_test(&config.status(), schema)
        .unwrap();
    let mut private = config.status();
    private["oauth_clients"] = json!(["online-client"]);
    assert!(
        crate::tool_runtime::startup_brief::validate_schema_instance_for_test(&private, schema)
            .is_err()
    );
    assert_eq!(
        ToolExposureConfig::default().resolve(McpSurface::Adaptive, None),
        ToolExposure::default()
    );
}

#[tokio::test]
async fn defaults_and_each_opt_in_share_inventory_routes_and_budgets() {
    let auth = oauth("inventory");
    for surface in [McpSurface::Adaptive, McpSurface::Cli] {
        for bits in 0..8 {
            let exposure = ToolExposure {
                goals: bits & 1 != 0,
                agent_continuation: bits & 2 != 0,
                job_continuation: bits & 4 != 0,
            };
            let mut config = ToolExposureConfig::default();
            config.adaptive = exposure;
            config.cli = exposure;
            let runtime = configured(config);
            for apps in [false, true] {
                let mut expected_names = None;
                for compact in [true, false] {
                    let listed = result(
                        request(
                            &runtime,
                            surface,
                            Some(&auth),
                            "tools/list",
                            json!({}),
                            compact,
                            apps,
                        )
                        .await,
                    );
                    let names = model_names(&listed);
                    let bytes = serde_json::to_vec(&listed).unwrap().len();
                    let mut model = listed.clone();
                    model["tools"]
                        .as_array_mut()
                        .unwrap()
                        .retain(|t| names.iter().any(|n| t["name"] == *n));
                    for tool in model["tools"].as_array_mut().unwrap() {
                        tool.as_object_mut().unwrap().remove("_meta");
                        tool.as_object_mut().unwrap().remove("title");
                    }
                    let model_bytes = serde_json::to_vec(&model).unwrap().len();
                    eprintln!("MCP_EXPOSURE surface={surface:?} bits={bits} apps={apps} compact={compact} count={} bytes={bytes} model_count={} model_bytes={model_bytes}", listed["tools"].as_array().unwrap().len(), names.len());
                    assert_eq!(
                        names.iter().collect::<std::collections::HashSet<_>>().len(),
                        names.len()
                    );
                    if let Some(expected) = &expected_names {
                        assert_eq!(&names, expected);
                    }
                    expected_names = Some(names.clone());
                    for name in &names {
                        if webcodex_tool_contracts::lookup_tool_definition(name).is_some() {
                            assert!(exposure.allows(name), "{surface:?}/{bits}: {name}");
                        }
                    }
                    for (name, enabled) in [
                        ("prepare_goal_workflow", exposure.goals),
                        ("create_agent_identity", exposure.agent_continuation),
                    ] {
                        assert_eq!(
                            names.iter().any(|n| n == name),
                            enabled,
                            "{surface:?}/{bits}/{name}"
                        );
                    }
                    if surface == McpSurface::Cli {
                        assert!(!names.iter().any(|n| crate::mcp::cli::is_app_tool(n)));
                        assert!(names.len() <= 26);
                        assert!(bytes < if bits == 0 { 40 * 1024 } else { 64 * 1024 });
                    } else {
                        // Keep the existing canonical all-enabled byte gates too.
                        // These additional ceilings guard the configurable surfaces.
                        assert!(
                            names.len()
                                <= 40
                                    + 5 * usize::from(exposure.goals)
                                    + 6 * usize::from(exposure.agent_continuation)
                                    + usize::from(exposure.job_continuation)
                        );
                        if compact {
                            assert!(
                                model_bytes <= 96 * 1024 + if bits == 0 { 0 } else { 32 * 1024 }
                            );
                            // Disabled Goal tools keep get/update only in the
                            // Workbench App inventory. Charge that measured move
                            // to transport, not an increased model-context budget.
                            let workbench_only_bytes: usize = if apps && !exposure.goals {
                                listed["tools"]
                                    .as_array()
                                    .unwrap()
                                    .iter()
                                    .filter(|t| {
                                        t["name"] == "get_goal" || t["name"] == "update_goal"
                                    })
                                    .map(|t| serde_json::to_vec(t).unwrap().len() + 1)
                                    .sum()
                            } else {
                                0
                            };
                            assert!(workbench_only_bytes <= 4 * 1024);
                            assert!(
                                bytes
                                    .saturating_sub(model_bytes)
                                    .saturating_sub(workbench_only_bytes)
                                    <= if apps { 35_000 } else { 8_000 }
                            );
                        } else {
                            assert!(bytes <= 4 * 1024 * 1024);
                        }
                        assert_eq!(
                            names.iter().any(|n| n == "present_goal_plan"),
                            exposure.goals
                        );
                        assert_eq!(
                            names.iter().any(|n| n == "present_agent_continuation"),
                            exposure.agent_continuation
                        );
                        assert_eq!(
                            names
                                .iter()
                                .any(|n| n == "present_job_terminal_continuation"),
                            exposure.job_continuation
                        );
                    }
                }
            }
        }
    }
}

#[tokio::test]
async fn disabled_workflows_reject_direct_gateway_and_stale_app_calls() {
    let runtime = test_runtime();
    let auth = oauth("blocked");
    for surface in [McpSurface::Adaptive, McpSurface::Cli] {
        for name in [
            "prepare_goal_workflow",
            "checkpoint_goal",
            "create_agent_identity",
            "consume_agent_wake",
            "wait_for_agent_events",
            "wait_for_job_terminal",
            "present_goal_plan",
            "present_agent_continuation",
            "bind_agent_continuation",
            "bind_job_terminal_continuation",
        ] {
            for gateway in [false, true] {
                let params = if gateway {
                    json!({"name":"call_runtime_tool","arguments":{"tool":name,"arguments":{}}})
                } else {
                    json!({"name":name,"arguments":{}})
                };
                let outcome = request(
                    &runtime,
                    surface,
                    Some(&auth),
                    "tools/call",
                    params,
                    true,
                    true,
                )
                .await;
                let McpOutcome::BadRequest(body) = outcome else {
                    panic!("{surface:?}/{name}/{gateway}: {outcome:?}");
                };
                assert!(
                    body["error"]["message"]
                        .as_str()
                        .unwrap()
                        .contains("unavailable"),
                    "{body}"
                );
            }
        }
        let manifest = result(
            request(
                &runtime,
                surface,
                Some(&auth),
                "tools/call",
                json!({"name":"read_tool_manifest","arguments":{"tool_name":"checkpoint_goal"}}),
                true,
                true,
            )
            .await,
        );
        assert_eq!(
            manifest["structuredContent"]["output"]["route"]["primary"]["mode"], "unavailable",
            "{manifest}"
        );
        for uri in [
            MCP_GOAL_PLAN_UI_RESOURCE_URI,
            MCP_AGENT_CONTINUATION_UI_RESOURCE_URI,
            MCP_JOB_TERMINAL_CONTINUATION_UI_RESOURCE_URI,
        ] {
            assert!(matches!(
                request(
                    &runtime,
                    surface,
                    Some(&auth),
                    "resources/read",
                    json!({"uri":uri}),
                    true,
                    true
                )
                .await,
                McpOutcome::BadRequest(_)
            ));
        }
    }
}

#[tokio::test]
async fn oauth_overrides_do_not_leak_between_requests_and_cli_review_is_direct_only() {
    let runtime = configured(ToolExposureConfig::parse(r#"{"oauth_clients":[{"client_id":"enabled","adaptive":{"goals":true,"agent_continuation":true},"cli":{"agent_continuation":true}}]}"#).unwrap());
    for surface in [McpSurface::Adaptive, McpSurface::Cli] {
        for client in ["enabled", "other", "enabled", "other"] {
            let auth = oauth(client);
            let list = result(
                request(
                    &runtime,
                    surface,
                    Some(&auth),
                    "tools/list",
                    json!({}),
                    true,
                    true,
                )
                .await,
            );
            assert_eq!(
                model_names(&list)
                    .iter()
                    .any(|n| n == "create_agent_identity"),
                client == "enabled"
            );
        }
        let auth = oauth("enabled");
        let manifest = result(request(&runtime, surface, Some(&auth), "tools/call", json!({"name":"read_tool_manifest","arguments":{"tool_name":"create_agent_identity"}}), true, true).await);
        assert_eq!(
            manifest["structuredContent"]["output"]["route"]["primary"]["mode"],
            "direct"
        );
        assert!(manifest["structuredContent"]["output"]["route"]["fallback"].is_null());
        let denied = request(&runtime, surface, Some(&auth), "tools/call", json!({"name":"call_runtime_tool","arguments":{"tool":"create_agent_identity","arguments":{}}}), true, true).await;
        let McpOutcome::BadRequest(denied) = denied else {
            panic!("{denied:?}");
        };
        assert!(denied["error"]["message"]
            .as_str()
            .unwrap()
            .contains("direct_host_review_required"));
        let mut no_scope = auth;
        no_scope.scopes = vec!["runtime:read".into()];
        let list = result(
            request(
                &runtime,
                surface,
                Some(&no_scope),
                "tools/list",
                json!({}),
                true,
                true,
            )
            .await,
        );
        assert!(!model_names(&list)
            .iter()
            .any(|n| n == "create_agent_identity"));
        let denied = request(&runtime, surface, Some(&no_scope), "tools/call", json!({"name":"create_agent_identity","arguments":{"handle":"test","display_name":"Test","idempotency_key":"no-scope"}}), true, true).await;
        assert!(matches!(denied, McpOutcome::Forbidden { .. }), "{denied:?}");
    }
}

#[tokio::test]
async fn workbench_keeps_only_its_independently_admitted_goal_controls() {
    let runtime = test_runtime();
    let listed = result(
        request(
            &runtime,
            McpSurface::Adaptive,
            None,
            "tools/list",
            json!({}),
            true,
            true,
        )
        .await,
    );
    for name in ["get_goal", "create_goal", "update_goal"] {
        let descriptor = listed["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == name)
            .unwrap();
        assert_eq!(
            descriptor.pointer("/_meta/ui/visibility"),
            Some(&json!(["app"]))
        );
        assert!(!model_names(&listed).iter().any(|n| n == name));
    }
}

#[tokio::test]
async fn default_discovery_cost_uses_the_canonical_admin_measurement() {
    // Same auth and projection as mcp_tools_list_stateless_serialized_size_budget
    // so main, all-enabled and configured defaults can be compared directly.
    let mut auth = crate::auth::shared_key_context("surface-size-test");
    auth.scopes.extend([
        crate::auth::SCOPE_PLUGIN_INSPECT.to_string(),
        crate::auth::SCOPE_PLUGIN_INVOKE.to_string(),
        crate::auth::SCOPE_PLUGIN_MANAGE.to_string(),
        crate::auth::SCOPE_ADMIN.to_string(),
    ]);
    let runtime = test_runtime();
    for surface in [McpSurface::Adaptive, McpSurface::Cli] {
        for apps in [false, true] {
            for compact in [true, false] {
                let listed = result(
                    request(
                        &runtime,
                        surface,
                        Some(&auth),
                        "tools/list",
                        json!({}),
                        compact,
                        apps,
                    )
                    .await,
                );
                let model = super::tools::model_visible_discovery_projection(&listed);
                let bytes = serde_json::to_vec(&listed).unwrap().len();
                let model_bytes = serde_json::to_vec(&model).unwrap().len();
                eprintln!("MCP_DEFAULT_COST surface={surface:?} apps={apps} compact={compact} count={} bytes={bytes} model_count={} model_bytes={model_bytes}", listed["tools"].as_array().unwrap().len(), model["tools"].as_array().unwrap().len());
                if compact {
                    assert!(model_bytes <= 96 * 1024);
                }
            }
        }
    }
}

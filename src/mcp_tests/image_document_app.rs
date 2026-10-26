use super::*;

#[test]
fn image_document_app_is_direct_and_uses_the_private_artifact_reader() {
    let payload =
        super::super::tools::mcp_tools_list_payload_with_features_for_auth(false, true, true, None);
    let tools = payload["tools"].as_array().unwrap();
    let present = tools
        .iter()
        .find(|tool| tool["name"] == "present_image")
        .unwrap();
    assert_eq!(
        present["_meta"]["ui"]["resourceUri"],
        "ui://webcodex/image/v5"
    );
    assert!(super::super::presentation::tool_requires_direct_app_presentation("present_image"));
    let read = tools
        .iter()
        .find(|tool| tool["name"] == "read_app_artifact_chunk")
        .unwrap();
    assert_eq!(read["_meta"]["ui"]["visibility"], json!(["app"]));
    assert!(
        !super::super::tools::adaptive_runtime_gateway_target_admitted_for_test(
            "read_app_artifact_chunk",
            true
        )
    );
}
